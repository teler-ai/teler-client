import Foundation
import Testing

@testable import TelerKit

@Suite struct TelerOriginTests {
    @Test func acceptsHTTPSAndLoopbackHTTP() throws {
        #expect(try TelerOrigin("https://app.teler.example/").description == "https://app.teler.example")
        #expect(try TelerOrigin("http://localhost:5175").description == "http://localhost:5175")
    }

    @Test func refusesInsecureOrNonOriginURLs() {
        #expect(throws: TelerOrigin.Invalid.insecure) { try TelerOrigin("http://app.teler.example") }
        #expect(throws: TelerOrigin.Invalid.notAnOrigin) { try TelerOrigin("https://a.example/app") }
        #expect(throws: TelerOrigin.Invalid.notAnOrigin) { try TelerOrigin("https://u:p@a.example") }
    }

    @Test func keepsPathsOnTheOrigin() throws {
        let origin = try TelerOrigin("https://app.teler.example")
        #expect(try origin.url(path: "/api/chat").absoluteString == "https://app.teler.example/api/chat")
        for path in ["api/chat", "//evil.example/x", "/api/../admin", "/api/./chat"] {
            #expect(throws: TelerAPIError.invalidEndpoint) { try origin.url(path: path) }
        }
    }

    @Test func validatesTheClientIdentity() {
        #expect(ClientIdentity(name: "teler-ios", version: "1.2.3")?.headerValue == "teler-ios/1.2.3")
        #expect(ClientIdentity(name: "Teler", version: "1.2.3") == nil)
        #expect(ClientIdentity(name: "teler-ios", version: "1.2") == nil)
        #expect(ClientIdentity(name: "teler-ios", version: "1.2.x") == nil)
    }
}

@Suite struct TelerAPIClientTests {
    @Test func sendsTheClientHeadersAndBearerToken() async throws {
        let transport = StubTransport([.response(status: 200, chunks: [#"{"chats":[],"total":0,"hasMore":false}"#])])
        _ = try await TelerAPIClient.stubbed(transport).chats(limit: 5)
        let request = try #require(transport.requests.first)
        #expect(request.url.absoluteString == "https://app.teler.example/api/chat?limit=5&offset=0")
        #expect(request.headers["Teler-Client"] == "teler-ios/0.1.0")
        #expect(request.headers["User-Agent"] == "teler-ios/0.1.0")
        #expect(request.headers["Authorization"] == "Bearer token-123")
        #expect(request.headers["Accept"] == "application/json")
        #expect(request.headers["Content-Type"] == nil)
    }

    @Test func reportsThatAnUpdateIsRequired() async {
        let transport = StubTransport([
            .response(
                status: 426,
                chunks: [#"{"error":"old","code":"CLIENT_UPDATE_REQUIRED","minVersion":"1.4.0"}"#])
        ])
        await #expect(throws: TelerAPIError.updateRequired(minimumVersion: "1.4.0")) {
            _ = try await TelerAPIClient.stubbed(transport).chats()
        }
    }

    @Test func readsOnlySafeCodesAndBoundsRetryAfter() async {
        let transport = StubTransport([
            .response(status: 429, headers: ["retry-after": "86400"], chunks: [#"{"code":"RATE_LIMITED"}"#]),
            .response(status: 403, chunks: [#"{"code":"see https://x.example?token=1"}"#]),
        ])
        let client = TelerAPIClient.stubbed(transport)
        await #expect(
            throws: TelerAPIError.http(status: 429, code: "RATE_LIMITED", retryAfter: .seconds(900))
        ) { _ = try await client.chats() }
        await #expect(throws: TelerAPIError.http(status: 403, code: nil, retryAfter: nil)) {
            _ = try await client.chats()
        }
    }

    @Test func refusesRedirectsAndHidesNetworkErrors() async {
        let transport = StubTransport([.response(status: 302, headers: ["Location": "https://evil.example"], chunks: []), .failure])
        let client = TelerAPIClient.stubbed(transport)
        await #expect(throws: TelerAPIError.redirectRefused(status: 302)) { _ = try await client.chats() }
        await #expect(throws: TelerAPIError.network) { _ = try await client.chats() }
    }

    @Test func rejectsAMalformedResponse() async {
        let transport = StubTransport([.response(status: 200, chunks: [#"{"chats":"nope"}"#])])
        await #expect(throws: TelerAPIError.invalidResponse) {
            _ = try await TelerAPIClient.stubbed(transport).chats()
        }
    }

    @Test func sendsAMessageLikeTheCLI() async throws {
        let accepted = #"{"taskId":"atask_01jccwkk02xywzpd6wmh3dkkg1","messageId":"msg_01jccwkk02xywzpd6wmh3dkkg1"}"#
        let transport = StubTransport([.response(status: 202, chunks: [accepted])])
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let acceptance = try await TelerAPIClient.stubbed(transport).sendMessage("Revenue?", to: chat)
        #expect(acceptance.taskId.rawValue == "atask_01jccwkk02xywzpd6wmh3dkkg1")
        let request = try #require(transport.requests.first)
        #expect(request.method == .post)
        #expect(request.headers["Content-Type"] == "application/json")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(request.body))
        #expect(body["modelSet"] == .string("lite"))
        #expect(body["deepAnalysis"] == .bool(false))
        let message = try #require(body["messages"]?.arrayValue?.first)
        #expect(message["role"] == .string("user"))
        #expect(message["content"] == .string("Revenue?"))
        #expect(message["id"]?.stringValue?.hasPrefix("ios_") == true)
    }

    @Test func parsesTimestampsWithMilliseconds() {
        #expect(TelerAPIClient.parseISO8601("2026-10-11T10:03:00.123Z") != nil)
        #expect(TelerAPIClient.parseISO8601("2026-10-11T10:03:00Z") != nil)
        #expect(TelerAPIClient.parseISO8601("yesterday") == nil)
    }
}
