import Foundation
import Testing

@testable import TelerKit

/// Exercises `URLSessionTransport` against a real server. Runs only when
/// `TELERKIT_SMOKE_ORIGIN` names one that serves the task stream below, for
/// example a loopback test server.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["TELERKIT_SMOKE_ORIGIN"] != nil))
struct LiveTransportTests {
    private func client(_ transport: URLSessionTransport) throws -> TelerAPIClient {
        let origin = ProcessInfo.processInfo.environment["TELERKIT_SMOKE_ORIGIN"] ?? ""
        return TelerAPIClient(
            origin: try TelerOrigin(origin),
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: transport)
    }

    @Test func streamsEventsAsTheyArrive() async throws {
        let transport = URLSessionTransport()
        defer { transport.invalidate() }
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let task = try #require(TaskID(rawValue: "atask_01jccwkk02xywzpd6wmh3dkkg1"))
        let clock = ContinuousClock()
        var arrivals: [ContinuousClock.Instant] = []
        var content: [ContentField] = []
        for try await event in try client(transport).taskEvents(chat: chat, task: task) {
            arrivals.append(clock.now)
            content = ContentMerge.append(event.fields, to: content)
        }
        #expect(content == [.text("Hello, world")])
        // The server pauses one second before its last events, so the first
        // one must have been delivered before the response finished.
        let first = try #require(arrivals.first)
        let last = try #require(arrivals.last)
        #expect(first.duration(to: last) > .milliseconds(800))
    }

    @Test func refusesARedirect() async throws {
        let transport = URLSessionTransport()
        defer { transport.invalidate() }
        await #expect(throws: TelerAPIError.redirectRefused(status: 302)) {
            _ = try await client(transport).chats()
        }
    }
}
