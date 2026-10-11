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
    private var streaming: (message: MessageID, content: [ContentField])?
    private(set) var streamTask: Task<Void, Never>?

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
                content: ContentMerge.latestPlans(message.content), isStreaming: false)
        }
        if let streaming {
            let item = Item(
                id: streaming.message.rawValue, role: .assistant, content: streaming.content,
                isStreaming: true)
            if let index = items.firstIndex(where: { $0.id == item.id }) {
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

    /// Stops following the stream, for example when the chat closes. The turn
    /// keeps running on the server and reattaches when the chat opens again.
    public func stop() {
        streamTask?.cancel()
        streamTask = nil
        streaming = nil
    }

    private func follow(task: TaskID, message: MessageID) {
        streamTask?.cancel()
        streaming = (message, [])
        streamTask = Task { [weak self, client, chat] in
            do {
                for try await event in client.taskEvents(chat: chat, task: task) {
                    guard let self, var current = self.streaming else { return }
                    current.content = ContentMerge.append(event.fields, to: current.content)
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
