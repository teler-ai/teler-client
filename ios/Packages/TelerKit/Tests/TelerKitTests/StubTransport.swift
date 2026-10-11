import Foundation
import Synchronization

@testable import TelerKit

/// Answers each request with the next queued reply and records the requests.
final class StubTransport: HTTPTransport, Sendable {
    enum Reply: Sendable {
        case response(status: Int, headers: [String: String] = [:], chunks: [String])
        case failure
    }

    private let replies: Mutex<[Reply]>
    private let sent = Mutex<[HTTPRequest]>([])

    init(_ replies: [Reply]) { self.replies = Mutex(replies) }

    var requests: [HTTPRequest] { sent.withLock { $0 } }

    func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse {
        sent.withLock { $0.append(request) }
        let reply = replies.withLock { $0.isEmpty ? Reply.failure : $0.removeFirst() }
        switch reply {
        case .failure:
            throw URLError(.notConnectedToInternet)
        case .response(let status, let headers, let chunks):
            return HTTPStreamingResponse(
                head: HTTPResponseHead(statusCode: status, headers: headers),
                body: AsyncThrowingStream { continuation in
                    for chunk in chunks { continuation.yield(Data(chunk.utf8)) }
                    continuation.finish()
                })
        }
    }
}

extension TelerAPIClient {
    static func stubbed(_ transport: StubTransport, token: String? = "token-123") -> TelerAPIClient {
        TelerAPIClient(
            origin: try! TelerOrigin("https://app.teler.example"),
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: transport,
            authentication: .bearer { token })
    }

    static func session(_ transport: StubTransport, jar: CookieJar) -> TelerAPIClient {
        TelerAPIClient(
            origin: try! TelerOrigin("https://app.teler.example"),
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: transport,
            authentication: .session(jar))
    }
}

/// `Set-Cookie` values in the shape Better Auth sends them.
enum Cookies {
    static let session =
        "__Secure-teler.session_token=tok.sig; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax"
    static let twoFactor =
        "__Secure-teler.two_factor=pending.sig; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax"
    static let sessionCleared =
        "__Secure-teler.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
}
