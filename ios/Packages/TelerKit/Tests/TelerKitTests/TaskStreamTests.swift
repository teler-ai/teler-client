import Foundation
import Testing

@testable import TelerKit

@Suite struct TaskStreamTests {
    private let chat = ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx")!
    private let task = TaskID(rawValue: "atask_01jccwkk02xywzpd6wmh3dkkg1")!
    private let instant = ReconnectPolicy(delays: [.zero, .zero])

    private func content(_ id: Int, _ json: String) -> String {
        "event: content\nid: \(id)\ndata: \(json)\n\n"
    }

    private func collect(_ client: TelerAPIClient) async throws -> [TaskStreamEvent] {
        var events: [TaskStreamEvent] = []
        for try await event in client.taskEvents(chat: chat, task: task, policy: instant) {
            events.append(event)
        }
        return events
    }

    @Test func followsATurnAcrossTheServerCapUntilDone() async throws {
        let transport = StubTransport([
            .response(
                status: 200,
                chunks: [
                    content(1, #"{"fields":[{"type":"text","text":"Rev"}],"done":false}"#),
                    "event: heartbeat\nid: 1\ndata: {\"ts\":1}\n\n",
                    content(1, #"{"fields":[],"done":false,"reconnect":true}"#),
                ]),
            .response(
                status: 200,
                chunks: [
                    content(1, #"{"fields":[{"type":"text","text":"enue"}],"done":false}"#),
                    content(1, #"{"fields":[],"done":true,"status":"completed"}"#),
                ]),
        ])
        let events = try await collect(TelerAPIClient.stubbed(transport))
        let merged = events.reduce([]) { ContentMerge.append($1.fields, to: $0) }
        #expect(merged == [.text("Revenue")])
        #expect(events.last?.status == .completed)
        let requests = transport.requests
        #expect(requests.count == 2)
        #expect(requests[0].headers["Last-Event-ID"] == nil)
        #expect(requests[1].headers["Last-Event-ID"] == "1")
        #expect(requests[1].headers["Accept"] == "text/event-stream")
        #expect(requests[1].url.path == "/api/chat/\(chat)/task/\(task)/stream")
    }

    @Test func reconnectsAfterADroppedConnection() async throws {
        let transport = StubTransport([
            .failure,
            .response(status: 503, chunks: ["{}"]),
            .response(status: 200, chunks: [content(0, #"{"fields":[],"done":true,"status":"failed"}"#)]),
        ])
        let events = try await collect(TelerAPIClient.stubbed(transport))
        #expect(events.map(\.status) == [.failed])
    }

    @Test func givesUpWhenTheConnectionKeepsDropping() async {
        let transport = StubTransport([.failure, .failure, .failure])
        await #expect(throws: TaskStreamError.connectionLost) {
            _ = try await collect(TelerAPIClient.stubbed(transport))
        }
    }

    @Test func stopsOnAStreamErrorOrLostAccess() async {
        let failing = StubTransport([.response(status: 200, chunks: ["event: error\ndata: {}\n\n"])])
        await #expect(throws: TaskStreamError.failed) {
            _ = try await collect(TelerAPIClient.stubbed(failing))
        }
        let unauthorized = StubTransport([.response(status: 401, chunks: ["{}"])])
        await #expect(throws: TelerAPIError.http(status: 401, code: nil, retryAfter: nil)) {
            _ = try await collect(TelerAPIClient.stubbed(unauthorized))
        }
    }
}
