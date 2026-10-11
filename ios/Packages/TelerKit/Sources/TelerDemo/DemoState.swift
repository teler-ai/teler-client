import Foundation
import TelerKit

/// The demo API's in-memory chats and running turns.
struct DemoState: Sendable {
    struct Message: Sendable {
        let id: String
        let role: String
        var content: [JSONValue]
        let createdAt: Date
        var completedAt: Date?
    }

    struct Chat: Sendable {
        let id: String
        var title: String?
        var updatedAt: Date
        var messages: [Message]
        var activeTask: (task: String, message: String)?
    }

    struct ScriptEvent: Sendable {
        let cursor: Int
        let wire: String
        let isTerminal: Bool
    }

    struct Turn: Sendable {
        let chat: String
        let message: String
        let events: [ScriptEvent]
        let content: [JSONValue]
    }

    private var chats: [Chat] = DemoData.chats()
    private var turns: [String: Turn] = [:]

    func chatPage() -> JSONValue {
        let summaries = chats.sorted { $0.updatedAt > $1.updatedAt }.map { chat in
            JSONValue.object([
                "id": .string(chat.id), "title": chat.title.map(JSONValue.string) ?? .null,
                "updatedAt": .string(DemoData.timestamp(chat.updatedAt)),
            ])
        }
        return .object([
            "chats": .array(summaries), "total": .number(Double(summaries.count)),
            "hasMore": .bool(false),
        ])
    }

    func chatDetail(_ id: String) -> JSONValue? {
        guard let chat = chats.first(where: { $0.id == id }) else { return nil }
        let messages = chat.messages.map { message in
            JSONValue.object([
                "id": .string(message.id), "role": .string(message.role),
                "content": .array(message.content),
                "createdAt": .string(DemoData.timestamp(message.createdAt)),
                "completedAt": message.completedAt.map { .string(DemoData.timestamp($0)) } ?? .null,
            ])
        }
        let active: JSONValue = chat.activeTask.map {
            .object([
                "id": .string($0.task), "messageId": .string($0.message),
                "status": .string("running"), "canCancel": .bool(true),
            ])
        } ?? .null
        return .object([
            "id": .string(chat.id), "title": chat.title.map(JSONValue.string) ?? .null,
            "messages": .array(messages), "activeAgentTask": active,
        ])
    }

    mutating func createChat(title: String?) -> String {
        let id = DemoData.newID("chat")
        chats.append(Chat(id: id, title: title, updatedAt: Date(), messages: []))
        return id
    }

    mutating func startTurn(chat id: String, question: String) -> JSONValue? {
        guard let index = chats.firstIndex(where: { $0.id == id }) else { return nil }
        let now = Date()
        let userMessage = Message(
            id: DemoData.newID("msg"), role: "user",
            content: [.object(["type": .string("text"), "text": .string(question)])],
            createdAt: now, completedAt: now)
        let answerID = DemoData.newID("msg")
        let taskID = DemoData.newID("atask")
        let script = DemoData.liveAnswer(to: question)
        chats[index].messages.append(userMessage)
        chats[index].messages.append(
            Message(id: answerID, role: "assistant", content: [], createdAt: now))
        if chats[index].title == nil { chats[index].title = String(question.prefix(60)) }
        chats[index].updatedAt = now
        chats[index].activeTask = (taskID, answerID)
        turns[taskID] = Turn(chat: id, message: answerID, events: script.events, content: script.content)
        return .object(["taskId": .string(taskID), "messageId": .string(answerID)])
    }

    func script(task: String) -> [ScriptEvent]? { turns[task]?.events }

    /// Stores the finished answer once its stream has delivered `done`.
    mutating func completeTurn(task: String) {
        guard let turn = turns[task],
            let chat = chats.firstIndex(where: { $0.id == turn.chat }),
            let message = chats[chat].messages.firstIndex(where: { $0.id == turn.message })
        else { return }
        chats[chat].messages[message].content = turn.content
        chats[chat].messages[message].completedAt = Date()
        chats[chat].activeTask = nil
    }
}

/// Builds a scripted answer as the server would stream it: whole new parts,
/// text suffixes for the last part, heartbeats, and a final `done`.
struct ScriptBuilder {
    private(set) var events: [DemoState.ScriptEvent] = []
    private(set) var content: [JSONValue] = []

    mutating func add(_ field: JSONValue) {
        content.append(field)
        emit(fields: [field])
    }

    mutating func extendText(_ suffix: String) {
        guard case .object(var last)? = content.last, let text = last["text"]?.stringValue else {
            return add(.object(["type": .string("text"), "text": .string(suffix)]))
        }
        last["text"] = .string(text + suffix)
        content[content.count - 1] = .object(last)
        emit(fields: [.object(["type": .string("text"), "text": .string(suffix)])])
    }

    mutating func heartbeat() {
        events.append(
            .init(
                cursor: content.count,
                wire: "event: heartbeat\nid: \(content.count)\ndata: {\"ts\":0}\n\n",
                isTerminal: false))
    }

    mutating func finish() {
        emit(fields: [], done: true)
    }

    private mutating func emit(fields: [JSONValue], done: Bool = false) {
        let payload = JSONValue.object([
            "fields": .array(fields), "done": .bool(done),
            "status": .string(done ? "completed" : "running"),
        ])
        let data = (try? JSONEncoder().encode(payload)).map { String(decoding: $0, as: UTF8.self) }
        events.append(
            .init(
                cursor: content.count,
                wire: "event: content\nid: \(content.count)\ndata: \(data ?? "{}")\n\n",
                isTerminal: done))
    }
}
