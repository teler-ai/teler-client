import Foundation
import Observation
import TelerKit

/// One chat: its stored messages plus the answer streaming right now.
@MainActor @Observable
public final class ConversationModel {
    public struct Item: Identifiable, Equatable, Sendable {
        public let id: String
        public let role: MessageRole
        public var content: [ContentField]
        public var isStreaming: Bool
        /// When Teler started and finished the message, for how long it worked.
        public var createdAt: Date?
        public var completedAt: Date?
    }

    public enum Phase: Equatable {
        case loading
        case ready
        case failed(Problem)
    }

    public enum AnswerSending: Equatable, Sendable {
        case sending
        case failed
    }

    public let chat: ChatID
    private let client: TelerAPIClient
    private let locale: TurnLocale
    public private(set) var title: String?
    public private(set) var phase = Phase.loading
    public private(set) var isSending = false
    public private(set) var streamProblem: Problem?
    public var draft = ""

    /// Teler's questions waiting for the member, when the latest turn ends with them.
    public private(set) var questionFlow: QuestionFlow?
    public private(set) var answerSending: AnswerSending?
    private var failedAnswers: QuestionAnswers?
    /// Questions that arrived while the chat was open.
    private var liveQuestionIDs = Set<String>()
    /// Files attached to the next question.
    public let attachments: AttachmentTray

    private var messages: [ChatMessage] = []
    private var streaming: Streaming?
    private(set) var streamTask: Task<Void, Never>?
    public private(set) var isStopping = false

    private struct Streaming {
        let task: TaskID
        let message: MessageID
        let startedAt: Date
        var content: [ContentField] = []
        var progress: TaskProgress?
        /// When the last part arrived, to say how old the progress is while reconnecting.
        var lastEventAt: Date?
    }

    /// Whether the running answer's stream is connected. When it drops for good,
    /// the turn keeps running on the server and the app reconnects.
    public enum Connection: Equatable, Sendable {
        case live
        /// Reconnecting at this time, or sooner with Retry now.
        case reconnecting(at: Date)
    }

    public private(set) var connection = Connection.live
    /// When the running answer last changed.
    public var lastEventAt: Date? { streaming?.lastEventAt }
    /// The stream's own quick retries, before the chat shows it's reconnecting.
    var streamPolicy = ReconnectPolicy.standard
    /// How long to wait between reconnecting attempts, the last repeating.
    var reconnectDelays: [Duration] = [.seconds(5), .seconds(10), .seconds(20), .seconds(30)]
    private var retryRequested = false

    /// How far the running step is, when Teler reports it, such as "4 of 5 regions".
    public var progress: TaskProgress? { streaming?.progress }
    public var isAnswering: Bool { streaming != nil }

    /// The member's last question, to ask again or edit after a failed answer.
    public var lastQuestion: String? {
        guard let message = messages.last(where: { $0.role == .user }) else { return nil }
        let text = message.content.compactMap { field -> String? in
            if case .text(let text) = field { return text }
            return nil
        }.joined(separator: "\n")
        return text.isEmpty ? nil : text
    }

    /// `language` is the app's language, which Teler answers in, such as `ca`.
    public init(chat: ChatID, client: TelerAPIClient, language: String = "en") {
        self.chat = chat
        self.client = client
        locale = TurnLocale(language: language)
        attachments = AttachmentTray(client: client, chat: chat)
    }

    /// Where each of Teler's questions stands, by tool call.
    public var questionStatuses: [String: QuestionStatus] { messages.questionStatuses() }

    /// Stored messages, with the streaming answer shown in place of its
    /// still-empty stored row.
    public var items: [Item] {
        var items = messages.map { message in
            Item(
                id: message.id.rawValue, role: message.role,
                content: ContentMerge.latestPlans(message.content), isStreaming: false,
                createdAt: message.createdAt, completedAt: message.completedAt)
        }
        if let streaming {
            var item = Item(
                id: streaming.message.rawValue, role: .assistant,
                content: ContentMerge.latestPlans(streaming.content), isStreaming: true,
                createdAt: streaming.startedAt)
            if let index = items.firstIndex(where: { $0.id == item.id }) {
                item.createdAt = items[index].createdAt ?? streaming.startedAt
                items[index] = item
            } else {
                items.append(item)
            }
        }
        return items
    }

    /// A question can go once it has text and every attached file is ready.
    public var canSend: Bool {
        !isSending && streaming == nil && !attachments.isBusy && !attachments.hasFailures
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public func load() async {
        do {
            let detail = try await client.chat(chat)
            title = detail.title
            messages = detail.messages
            phase = .ready
            syncQuestion()
            if streaming == nil, let active = detail.activeAgentTask {
                follow(task: active.id, message: active.messageId)
            }
        } catch is CancellationError {
            return
        } catch {
            if messages.isEmpty { phase = .failed(Problem(error)) }
        }
    }

    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        do {
            let files = attachments.turn
            let turn = try await client.sendMessage(
                text, to: chat, locale: locale, attachments: files.isEmpty ? nil : files)
            draft = ""
            attachments.clear()
            streamProblem = nil
            follow(task: turn.taskId, message: turn.messageId)
            await load()
        } catch {
            streamProblem = Problem(error)
        }
    }

    // MARK: Teler's questions

    /// Answers the current question with option `index`, sending every answer after the last question.
    public func pick(_ index: Int) async {
        guard var flow = questionFlow, answerSending != .sending else { return }
        let complete = flow.pick(index)
        questionFlow = flow
        if let complete { await send(QuestionAnswers(toolCallId: flow.call.toolCallID, source: .user, answers: complete)) }
    }

    /// Answers the current question with the draft, in the member's own words.
    public func answerInOwnWords() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var flow = questionFlow, !text.isEmpty, answerSending != .sending else { return }
        let complete = flow.record(QuestionAnswer(flow.question, ownWords: text))
        questionFlow = flow
        draft = ""
        if let complete { await send(QuestionAnswers(toolCallId: flow.call.toolCallID, source: .user, answers: complete)) }
    }

    /// Sends the answers so far with Teler's picks for the rest.
    public func acceptPicks() async {
        guard var flow = questionFlow, answerSending != .sending else { return }
        flow.touch()
        questionFlow = flow
        await send(QuestionAnswers(toolCallId: flow.call.toolCallID, source: .user, answers: flow.withPicks))
    }

    /// Sends Teler's picks once a live question has gone 30 seconds untouched.
    public func autoAnswer() async {
        guard let flow = questionFlow, flow.countsDown, answerSending == nil else { return }
        let picks = flow.call.questions.map { QuestionAnswer($0, option: 0) }
        await send(QuestionAnswers(toolCallId: flow.call.toolCallID, source: .auto, answers: picks))
    }

    public func previousQuestion() {
        questionFlow?.back()
    }

    /// Stops the countdown to Teler's picks, such as when the member starts typing.
    public func touchQuestion() {
        questionFlow?.touch()
    }

    public func retryAnswers() async {
        if let failedAnswers { await send(failedAnswers) }
    }

    private func send(_ answers: QuestionAnswers) async {
        answerSending = .sending
        do {
            let turn = try await client.sendMessage(answers.text, to: chat, locale: locale, answers: answers)
            answerSending = nil
            failedAnswers = nil
            streamProblem = nil
            follow(task: turn.taskId, message: turn.messageId)
            await load()
        } catch {
            answerSending = .failed
            failedAnswers = answers
        }
    }

    /// Shows the waiting questions once no turn is running, keeping the member's
    /// progress while they're the same questions.
    private func syncQuestion() {
        guard streaming == nil, let call = messages.pendingQuestion() else {
            questionFlow = nil
            return
        }
        guard questionFlow?.call.toolCallID != call.toolCallID else { return }
        questionFlow = QuestionFlow(call: call, isLive: liveQuestionIDs.contains(call.toolCallID))
        answerSending = nil
    }

    /// Asks `question` as the next turn, such as a suggested follow-up.
    public func ask(_ question: String) async {
        draft = question
        await send()
    }

    /// Asks Teler to stop the running turn; the stream then ends as stopped.
    public func cancel() async {
        guard let streaming, !isStopping else { return }
        isStopping = true
        defer { isStopping = false }
        do {
            _ = try await client.cancelTask(streaming.task, in: chat)
        } catch {
            streamProblem = Problem(error)
        }
    }

    /// Stops following the stream, for example when the chat closes. The turn
    /// keeps running on the server and reattaches when the chat opens again.
    public func stop() {
        streamTask?.cancel()
        streamTask = nil
        streaming = nil
    }

    /// Reconnects now instead of waiting, such as when the network is back.
    public func retryNow() {
        if case .reconnecting = connection { retryRequested = true }
    }

    private func follow(task: TaskID, message: MessageID) {
        // Nothing waits for an answer while a turn runs.
        questionFlow = nil
        streamTask?.cancel()
        connection = .live
        streaming = Streaming(task: task, message: message, startedAt: Date())
        streamTask = Task { [weak self, client, chat] in
            var attempt = 0
            while true {
                // After a reconnect the server sends the whole answer again;
                // the last one seen stays until it does.
                var replaces = attempt > 0
                do {
                    guard let policy = self?.streamPolicy else { return }
                    for try await event in client.taskEvents(chat: chat, task: task, policy: policy) {
                        guard let self, var current = self.streaming else { return }
                        if replaces {
                            current.content = []
                            replaces = false
                        }
                        current.content = ContentMerge.append(event.fields, to: current.content)
                        if let progress = event.progress { current.progress = progress }
                        current.lastEventAt = Date()
                        self.streaming = current
                        self.connection = .live
                        attempt = 0
                        for case .question(let call) in current.content where call.status == .shown {
                            self.liveQuestionIDs.insert(call.toolCallID)
                        }
                    }
                    break
                } catch is CancellationError {
                    return
                } catch TaskStreamError.connectionLost, TelerAPIError.network {
                    guard let self else { return }
                    attempt += 1
                    guard await self.waitToReconnect(attempt: attempt) else { return }
                } catch {
                    self?.streamProblem = Problem(error)
                    break
                }
            }
            // Like the web app, reload once the turn ends to show the stored,
            // complete answer.
            guard let self, !Task.isCancelled else { return }
            self.connection = .live
            await self.load()
            self.streaming = nil
            self.syncQuestion()
        }
    }

    /// Waits before reconnecting, longer each time, or until Retry now.
    /// False when the chat stopped following meanwhile.
    private func waitToReconnect(attempt: Int) async -> Bool {
        let delay = reconnectDelays.isEmpty ? .zero : reconnectDelays[min(attempt, reconnectDelays.count) - 1]
        let seconds = Double(delay.components.seconds) + Double(delay.components.attoseconds) / 1e18
        let deadline = Date().addingTimeInterval(seconds)
        connection = .reconnecting(at: deadline)
        retryRequested = false
        while Date() < deadline, !retryRequested {
            do {
                try await Task.sleep(for: .milliseconds(250))
            } catch {
                return false
            }
        }
        return !Task.isCancelled
    }
}
