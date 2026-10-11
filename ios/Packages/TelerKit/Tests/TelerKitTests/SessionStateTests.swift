import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// What the whole app shows for the session: setup on the web, signing in
/// again over open screens, and versions the server no longer supports.
@MainActor @Suite struct SessionStateTests {
    private let user = #"{"session":{"id":"ses_1"},"user":{"id":"usr_1","name":"Ada","email":"ada@example.com"}}"#
    private let ada = SignedInUser(id: "usr_1", name: "Ada", email: "ada@example.com")

    private func reply(_ status: Int, _ body: String, cookie: String? = nil) -> StubTransport.Reply {
        .response(status: status, headers: cookie.map { ["Set-Cookie": $0] } ?? [:], chunks: [body])
    }

    private func session(_ transport: StubTransport) -> SessionModel {
        SessionModel(
            origin: try! TelerOrigin("https://app.teler.example"),
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: transport, store: MemorySessionStore(),
            demoClient: TelerAPIClient(
                origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
                transport: DemoTransport(chunkDelay: .zero)))
    }

    private func signIn(_ session: SessionModel) async {
        let signIn = session.makeSignIn()
        signIn.email = "ada@example.com"
        signIn.password = "secret"
        await signIn.submit()
    }

    /// Lets the session handle what the transport reported.
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    @Test func asksToFinishSettingUpWithoutAnOrganization() async {
        let transport = StubTransport([
            reply(200, #"{"token":"tok"}"#, cookie: Cookies.session), reply(200, user),
            reply(200, #"{"user":{"id":"usr_1","name":"Ada"},"activeOrganizationId":null}"#),
        ])
        let session = session(transport)
        await signIn(session)
        #expect(session.state == .setupRequired(ada))
    }

    @Test func asksToFinishSettingUpWhenTheWebSaysSo() async {
        let transport = StubTransport([
            reply(200, #"{"token":"tok"}"#, cookie: Cookies.session), reply(200, user),
            reply(403, #"{"error":{"code":"REGISTRATION_REQUIRED"}}"#),
        ])
        let session = session(transport)
        await signIn(session)
        #expect(session.state == .setupRequired(ada))
    }

    @Test func asksToSignInAgainWhenTheServerEndsTheSession() async throws {
        let transport = StubTransport([
            reply(200, #"{"token":"tok"}"#, cookie: Cookies.session), reply(200, user),
            reply(200, #"{"activeOrganizationId":"org_01jczpznh32py20pd8y10ef9cq"}"#),
            reply(401, #"{"code":"UNAUTHORIZED"}"#),
            reply(200, #"{"token":"tok2"}"#, cookie: Cookies.session), reply(200, user),
            reply(200, #"{"activeOrganizationId":"org_01jczpznh32py20pd8y10ef9cq"}"#),
        ])
        let session = session(transport)
        await signIn(session)
        #expect(session.state == .signedIn(ada))
        #expect(!session.sessionExpired)

        _ = try? await session.client.chats()
        await settle()
        #expect(session.sessionExpired)
        #expect(session.state == .signedIn(ada))

        await signIn(session)
        #expect(!session.sessionExpired)
        #expect(session.state == .signedIn(ada))
    }

    @Test func aWrongPasswordIsNotAnEndedSession() async {
        let transport = StubTransport([reply(401, #"{"code":"INVALID_EMAIL_OR_PASSWORD"}"#)])
        let session = session(transport)
        await session.restore()
        await signIn(session)
        await settle()
        #expect(session.state == .signedOut)
        #expect(!session.sessionExpired)
    }

    @Test func blocksAVersionTheServerNoLongerSupports() async {
        let transport = StubTransport([
            reply(426, #"{"error":"Update required","code":"CLIENT_UPDATE_REQUIRED","minVersion":"0.2.0"}"#)
        ])
        let session = session(transport)
        _ = try? await session.client.chats()
        await settle()
        #expect(session.updateRequired)
    }
}
