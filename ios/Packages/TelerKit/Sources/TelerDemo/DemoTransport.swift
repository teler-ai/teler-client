import Foundation
import Synchronization
import TelerKit

/// An offline Teler API for previews and the demo mode. It answers the chat
/// endpoints the app uses with the same wire format as the server, including
/// streamed answers, so the real client and stream parser run unchanged.
public final class DemoTransport: HTTPTransport, Sendable {
    public static let origin = DemoData.origin

    private let state: Mutex<DemoState>
    private let chunkDelay: Duration

    public init(chunkDelay: Duration = .milliseconds(60)) {
        self.state = Mutex(DemoState())
        self.chunkDelay = chunkDelay
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse {
        let path = request.url.path.split(separator: "/").map(String.init)
        if request.method == .get, path == ["api", "teler-cli", "me"] {
            return Self.json(200, .object(["activeOrganizationId": .string(DemoData.organization.rawValue)]))
        }
        guard path.count >= 2, path[0] == "api", path[1] == "chat" else { return Self.notFound() }
        switch (request.method, path.count) {
        case (.get, 2):
            return Self.json(200, state.withLock { $0.chatPage() })
        case (.post, 2):
            let title = Self.body(request)?["title"]?.stringValue
            return Self.json(200, .object(["id": .string(state.withLock { $0.createChat(title: title) })]))
        case (.get, 3) where path[2] == "search":
            let text = Self.query(request, "q") ?? ""
            return Self.json(200, state.withLock { $0.chatPage(matching: text) })
        case (.get, 3) where path[2] == "starter-prompts":
            let prompts = DemoData.starterPrompts.enumerated().map { index, label in
                JSONValue.object(["id": .string("starter-\(index)"), "label": .string(label)])
            }
            return Self.json(200, .object(["prompts": .array(prompts)]))
        case (.get, 3):
            guard let detail = state.withLock({ $0.chatDetail(path[2]) }) else { return Self.notFound() }
            return Self.json(200, detail)
        case (.post, 4) where path[3] == "message":
            let messages = Self.body(request)?["messages"]?.arrayValue
            guard let text = messages?.first?["content"]?.stringValue,
                let accepted = state.withLock({ $0.startTurn(chat: path[2], question: text) })
            else { return Self.notFound() }
            return Self.json(202, accepted)
        case (.get, 6) where path[3] == "artifact" && path[5] == "data":
            guard let spec = DemoData.chartSpec(path[4]) else { return Self.notFound() }
            return Self.json(200, spec)
        case (.post, 6) where path[3] == "task" && path[5] == "cancel":
            return Self.json(200, .object(["cancelled": .bool(false)]))
        case (.get, 6) where path[3] == "task" && path[5] == "stream":
            let task = path[4]
            guard let events = state.withLock({ $0.script(task: task) }) else { return Self.notFound() }
            // Like the server, a reconnect resumes after the parts already sent.
            let resumeAfter = request.headers["Last-Event-ID"].flatMap(Int.init) ?? 0
            return stream(task: task, events.filter { $0.cursor > resumeAfter || $0.isTerminal })
        default:
            return Self.notFound()
        }
    }

    private func stream(task: String, _ events: [DemoState.ScriptEvent]) -> HTTPStreamingResponse {
        let delay = chunkDelay
        let body = AsyncThrowingStream<Data, Error> { continuation in
            let producer = Task {
                for event in events {
                    try? await Task.sleep(for: delay)
                    if Task.isCancelled { break }
                    if event.isTerminal { self.state.withLock { $0.completeTurn(task: task) } }
                    continuation.yield(Data(event.wire.utf8))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
        return HTTPStreamingResponse(
            head: HTTPResponseHead(statusCode: 200, headers: ["Content-Type": "text/event-stream"]),
            body: body)
    }

    private static func query(_ request: HTTPRequest, _ name: String) -> String? {
        URLComponents(url: request.url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == name }?.value
    }

    private static func body(_ request: HTTPRequest) -> JSONValue? {
        request.body.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
    }

    static func json(_ status: Int, _ value: JSONValue) -> HTTPStreamingResponse {
        let data = (try? JSONEncoder().encode(value)) ?? Data()
        return HTTPStreamingResponse(
            head: HTTPResponseHead(statusCode: status, headers: ["Content-Type": "application/json"]),
            body: AsyncThrowingStream { continuation in
                continuation.yield(data)
                continuation.finish()
            })
    }

    private static func notFound() -> HTTPStreamingResponse {
        json(404, .object(["error": .string("Not found"), "code": .string("NOT_FOUND")]))
    }
}
