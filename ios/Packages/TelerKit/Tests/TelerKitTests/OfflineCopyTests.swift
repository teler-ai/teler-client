import Foundation
import Testing

@testable import TelerKit

/// A saved copy of what Today, Chats and Dashboards read, for when there's no connection.
@Suite struct OfflineCopyTests {
    private func directory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("offline-\(UUID().uuidString)")
    }

    private func request(_ path: String, _ method: HTTPMethod = .get) -> HTTPRequest {
        HTTPRequest(url: URL(string: "https://app.teler.example\(path)")!, method: method, headers: [:], body: nil)
    }

    @Test func answersWithTheSavedCopyWhenOffline() async throws {
        let base = StubTransport([
            .response(status: 200, chunks: [#"{"chats":[{"id":"c"}]}"#]),
            .failure,
        ])
        let transport = OfflineCopyTransport(base, directory: directory())
        let online = try await transport.send(request("/api/chat?organizationId=org_1&limit=3"))
        #expect(try await online.collectBody(limit: 1000) == Data(#"{"chats":[{"id":"c"}]}"#.utf8))
        #expect(online.head.header(OfflineCopyTransport.savedAtHeader) == nil)
        #expect(transport.savedAt != nil)

        // Same query in another order: the same saved copy.
        let offline = try await transport.send(request("/api/chat?limit=3&organizationId=org_1"))
        #expect(try await offline.collectBody(limit: 1000) == Data(#"{"chats":[{"id":"c"}]}"#.utf8))
        #expect(offline.head.header(OfflineCopyTransport.savedAtHeader) != nil)
    }

    @Test func keepsOnlyTheReadsItShould() {
        #expect(OfflineCopyTransport.keeps("/api/chat"))
        #expect(OfflineCopyTransport.keeps("/api/chat/chat_01"))
        #expect(OfflineCopyTransport.keeps("/api/chat/chat_01/artifact/revenue/data"))
        #expect(OfflineCopyTransport.keeps("/api/home/flags"))
        #expect(OfflineCopyTransport.keeps("/api/dashboard/dash_1/widget/w/data"))
        #expect(!OfflineCopyTransport.keeps("/api/chat/search"))
        #expect(!OfflineCopyTransport.keeps("/api/chat/starter-prompts"))
        #expect(!OfflineCopyTransport.keeps("/api/chat/chat_01/task/atask_1/stream"))
        #expect(!OfflineCopyTransport.keeps("/api/auth/get-session"))
        #expect(!OfflineCopyTransport.keeps("/api/account/preflight"))
    }

    @Test func neverSavesWritesAndForgetsOnClear() async throws {
        let base = StubTransport([
            .response(status: 202, chunks: ["{}"]),
            .response(status: 200, chunks: ["[1]"]),
            .failure,
        ])
        let transport = OfflineCopyTransport(base, directory: directory())
        _ = try await transport.send(request("/api/chat", .post))
        #expect(transport.savedAt == nil)
        _ = try await transport.send(request("/api/dashboard"))
        transport.clear()
        await #expect(throws: (any Error).self) {
            _ = try await transport.send(request("/api/dashboard"))
        }
    }
}
