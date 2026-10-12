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
        if request.method == .get, path.count >= 2, path[0] == "api", path[1] == "dashboard" {
            return dashboard(path)
        }
        if let response = needsYou(request.method, path, body: Self.body(request)) { return response }
        if let response = uploads(request.method, path, body: Self.body(request)) { return response }
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
            let body = Self.body(request)
            guard let text = body?["messages"]?.arrayValue?.first?["content"]?.stringValue,
                let accepted = state.withLock({
                    $0.startTurn(
                        chat: path[2], question: text, answers: body?["questionAnswers"],
                        references: body?["fileReferences"]?.arrayValue ?? [])
                })
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

    /// Home's Needs you: Agent findings, marking them seen, and access requests.
    private func needsYou(_ method: HTTPMethod, _ path: [String], body: JSONValue?) -> HTTPStreamingResponse? {
        switch (method, path) {
        case (.get, ["api", "home", "flags"]):
            return Self.json(200, DemoNeedsYou.findings(seen: state.withLock { $0.seenFindings }))
        case (.post, let path) where path.count == 5 && path[1] == "home" && path[4] == "seen":
            state.withLock { _ = $0.seenFindings.insert(path[3]) }
            return Self.json(200, .object(["runId": .string(path[3])]))
        case (.post, let path) where path.count == 4 && path[1] == "alerts" && path[3] == "seen":
            state.withLock { _ = $0.seenFindings.insert(path[2]) }
            return Self.json(200, .object(["alertId": .string(path[2])]))
        case (.get, ["api", "access", "activity"]):
            return Self.json(200, DemoNeedsYou.accessActivity(decided: state.withLock { $0.accessDecided }))
        case (.get, let path) where path.count == 5 && path[1] == "access" && path[4] == "review":
            return path[3] == DemoNeedsYou.accessRequest ? Self.json(200, DemoNeedsYou.reviewItems) : Self.notFound()
        case (.post, let path) where path.count == 5 && path[1] == "access" && path[4] == "decide":
            guard path[3] == DemoNeedsYou.accessRequest, body?["decision"] != nil else { return Self.notFound() }
            state.withLock { $0.accessDecided = true }
            return Self.json(200, .object(["id": .string(path[3])]))
        default:
            return nil
        }
    }

    /// Uploads into a chat's folder: parts, then a short processing step,
    /// then a document, a table for data files.
    private func uploads(_ method: HTTPMethod, _ path: [String], body: JSONValue?) -> HTTPStreamingResponse? {
        guard path.count >= 2, path[0] == "api", path[1] == "uploads" || path[1] == "documents" else { return nil }
        switch (method, path.count) {
        case (.post, 2) where path[1] == "uploads":
            guard let name = body?["filename"]?.stringValue, let size = body?["sizeBytes"]?.doubleValue,
                let folder = body?["destinationPath"]?.stringValue
            else { return Self.json(400, .object(["error": .string("Invalid upload")])) }
            let job = DemoData.newID("fpjob")
            state.withLock { $0.uploads[job] = (name, String(folder.split(separator: "/").last ?? ""), 0) }
            let partSize = 8 * 1024 * 1024
            return Self.json(
                201,
                .object([
                    "jobId": .string(job), "partSizeBytes": .number(Double(partSize)),
                    "partCount": .number(Double(max(1, Int((size / Double(partSize)).rounded(.up))))),
                ]))
        case (.put, 5) where path[3] == "parts":
            return Self.json(204, .null)
        case (.post, 4) where path[3] == "heartbeat":
            return Self.json(200, .object([:]))
        case (.post, 4) where path[3] == "complete":
            return Self.json(201, .object(["jobId": .string(path[2]), "status": .string("queued")]))
        case (.delete, 3) where path[1] == "uploads":
            state.withLock { _ = $0.uploads.removeValue(forKey: path[2]) }
            return Self.json(200, .object([:]))
        case (.get, 3) where path[1] == "uploads":
            guard let reads = state.withLock({ state -> Int? in
                guard state.uploads[path[2]] != nil else { return nil }
                state.uploads[path[2]]?.reads += 1
                return state.uploads[path[2]]?.reads
            }) else { return Self.notFound() }
            let done = reads > 1
            return Self.json(
                200,
                .object([
                    "jobId": .string(path[2]), "status": .string(done ? "completed" : "processing"),
                    "processing": .object(["phase": .string("parsing"), "percentage": .number(40)]),
                    "outputs": .array(
                        done ? [.object(["status": .string("completed"), "documentId": .string("doc_" + path[2].dropFirst(6))])] : []),
                ]))
        case (.get, 3) where path[1] == "documents":
            let job = "fpjob_" + path[2].dropFirst(4)
            guard let upload = state.withLock({ $0.uploads[job] }) else { return Self.notFound() }
            let isData = UploadRules.kind(of: upload.name) == .data
            let stem = upload.name.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "_" }
            return Self.json(
                200,
                .object([
                    "id": .string(path[2]), "name": .string(upload.name), "scope": .string("personal"),
                    "path": .string("chats/\(upload.chat)/\(upload.name)"),
                    "type": .string(UploadRules.kind(of: upload.name) == .image ? "image" : "file"),
                    "table": isData
                        ? .object(["ingestStatus": .string("ready"), "sourceRef": .string("personal." + String(stem))]) : .null,
                ]))
        default:
            return Self.notFound()
        }
    }

    private func dashboard(_ path: [String]) -> HTTPStreamingResponse {
        switch path.count {
        case 2:
            return Self.json(200, DemoData.dashboardPage())
        case 3:
            return DemoData.dashboardDetail(path[2]).map { Self.json(200, $0) } ?? Self.notFound()
        case 6 where path[3] == "widget" && path[5] == "data":
            return DemoData.widgetSpec(path[4]).map { Self.json(200, $0) } ?? Self.notFound()
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
