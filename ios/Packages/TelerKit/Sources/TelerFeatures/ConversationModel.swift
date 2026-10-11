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

    public let chat: ChatID
    private let client: TelerAPIClient
    public private(set) var title: String?
    public private(set) var phase = Phase.loading
    public private(set) var isSending = false
    public private(set) var streamProblem: Problem?
    public var draft = ""

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
    }

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

    public init(chat: ChatID, client: TelerAPIClient) {
        self.chat = chat
        self.client = client
    }

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

    public var canSend: Bool {
        !isSending && streaming == nil
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public func load() async {
        do {
            let detail = try await client.chat(chat)
            title = detail.title
            messages = detail.messages
            phase = .ready
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
            let turn = try await client.sendMessage(text, to: chat)
            draft = ""
            streamProblem = nil
            follow(task: turn.taskId, message: turn.messageId)
            await load()
        } catch {
            streamProblem = Problem(error)
        }
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

    private func follow(task: TaskID, message: MessageID) {
        streamTask?.cancel()
        streaming = Streaming(task: task, message: message, startedAt: Date())
        streamTask = Task { [weak self, client, chat] in
            do {
                for try await event in client.taskEvents(chat: chat, task: task) {
                    guard let self, var current = self.streaming else { return }
                    current.content = ContentMerge.append(event.fields, to: current.content)
                    if let progress = event.progress { current.progress = progress }
                    self.streaming = current
                }
            } catch is CancellationError {
                return
            } catch {
                self?.streamProblem = Problem(error)
            }
            // Like the web app, reload once the turn ends to show the stored,
            // complete answer.
            guard let self, !Task.isCancelled else { return }
            await self.load()
            self.streaming = nil
        }
    }
}
