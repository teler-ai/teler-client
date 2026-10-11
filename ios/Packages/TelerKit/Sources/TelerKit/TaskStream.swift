import Foundation

public enum TaskStatus: String, Sendable, Hashable, Decodable {
    case pending, claimed, running, completed, failed, cancelled, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }

    public var isTerminal: Bool { self == .completed || self == .failed || self == .cancelled }
}

public struct TaskProgress: Sendable, Hashable, Decodable {
    public let current: Int
    public let total: Int
    public let message: String
}

/// One `content` event of a chat turn's stream. `fields` holds only what is
/// new; merge it with `ContentMerge.append`.
public struct TaskStreamEvent: Sendable, Decodable {
    public let fields: [ContentField]
    public let done: Bool
    public let reconnect: Bool
    public let status: TaskStatus?
    public let progress: TaskProgress?

    private enum CodingKeys: String, CodingKey {
        case fields, done, reconnect, status, progress
    }

    public init(
        fields: [ContentField], done: Bool, reconnect: Bool = false, status: TaskStatus? = nil,
        progress: TaskProgress? = nil
    ) {
        self.fields = fields
        self.done = done
        self.reconnect = reconnect
        self.status = status
        self.progress = progress
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        fields = try container.decodeIfPresent([ContentField].self, forKey: .fields) ?? []
        done = try container.decode(Bool.self, forKey: .done)
        reconnect = try container.decodeIfPresent(Bool.self, forKey: .reconnect) ?? false
        status = try container.decodeIfPresent(TaskStatus.self, forKey: .status)
        progress = try? container.decodeIfPresent(TaskProgress.self, forKey: .progress)
    }
}

public enum TaskStreamError: Error, Equatable, Sendable {
    /// The server reported a stream error, for example lost access.
    case failed
    /// The connection kept dropping and the retries ran out.
    case connectionLost
}

/// How long to wait between reconnect attempts after the connection drops.
/// Attempts reset whenever an event arrives.
public struct ReconnectPolicy: Sendable {
    public var delays: [Duration]

    public init(delays: [Duration]) { self.delays = delays }

    public static let standard = ReconnectPolicy(delays: [
        .milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8),
    ])
}

extension TelerAPIClient {
    /// Follows a chat turn until it is done, resuming with `Last-Event-ID`
    /// after the server's 15-minute cap or a dropped connection.
    public func taskEvents(
        chat: ChatID, task: TaskID, resumingAfter lastEventID: String? = nil,
        policy: ReconnectPolicy = .standard
    ) -> AsyncThrowingStream<TaskStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let worker = Task {
                do {
                    try await followTask(
                        chat: chat, task: task, lastEventID: lastEventID, policy: policy,
                        emit: { continuation.yield($0) })
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in worker.cancel() }
        }
    }

    private func followTask(
        chat: ChatID, task: TaskID, lastEventID initialID: String?, policy: ReconnectPolicy,
        emit: (TaskStreamEvent) -> Void
    ) async throws {
        let path = "/api/chat/\(chat.rawValue)/task/\(task.rawValue)/stream"
        var lastEventID = initialID
        var failures = 0
        while true {
            try Task.checkCancellation()
            var parser = SSEParser()
            var progressed = false
            do {
                var headers = ["Cache-Control": "no-cache"]
                if let lastEventID { headers["Last-Event-ID"] = lastEventID }
                let response = try await send(
                    .get, path, headers: headers, accept: "text/event-stream")
                stream: for try await chunk in response.body {
                    for message in try parser.consume(chunk) {
                        if let id = message.lastEventID { lastEventID = id }
                        switch message.event {
                        case "error":
                            throw TaskStreamError.failed
                        case "content":
                            guard
                                let event = try? JSONDecoder().decode(
                                    TaskStreamEvent.self, from: Data(message.data.utf8))
                            else { continue }
                            progressed = true
                            failures = 0
                            emit(event)
                            if event.done { return }
                            if event.reconnect { break stream }
                        default:
                            continue  // Heartbeats and future event types.
                        }
                    }
                }
                // The stream ended without `done`: reconnect.
            } catch let error as TelerAPIError {
                switch error {
                case .network: break
                case .http(let status, _, let retryAfter) where status == 429 || status >= 500:
                    if let retryAfter { try await Task.sleep(for: retryAfter) }
                default: throw error
                }
            } catch is SSEParserError {
                throw TelerAPIError.invalidResponse
            }
            if !progressed { failures += 1 }
            guard failures <= policy.delays.count else { throw TaskStreamError.connectionLost }
            if failures > 0 { try await Task.sleep(for: policy.delays[failures - 1]) }
        }
    }
}
