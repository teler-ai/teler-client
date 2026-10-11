import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

@MainActor @Suite struct SignInModelTests {
    private let user = #"{"session":{"id":"ses_1"},"user":{"id":"usr_1","name":"Ada","email":"ada@example.com"}}"#

    private func session(_ transport: StubTransport, store: SessionStore = MemorySessionStore())
        -> SessionModel
    {
        SessionModel(
            origin: try! TelerOrigin("https://app.teler.example"),
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: transport, store: store,
            demoClient: TelerAPIClient(
                origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
                transport: DemoTransport(chunkDelay: .zero)))
    }

    @Test func signsInThroughTheCaptchaAndTheSecondFactor() async throws {
        let transport = StubTransport([
            .response(status: 400, chunks: [#"{"code":"MISSING_RESPONSE","message":"Missing CAPTCHA response"}"#]),
            .response(status: 200, chunks: [#"<meta name="teler-turnstile-site-key" content="0x4AAAAAAA">"#]),
            .response(
                status: 200, headers: ["Set-Cookie": Cookies.twoFactor],
                chunks: [#"{"twoFactorRedirect":true,"twoFactorMethods":["totp"]}"#]),
            .response(status: 200, headers: ["Set-Cookie": Cookies.session], chunks: [#"{"token":"tok"}"#]),
            .response(status: 200, chunks: [user]),
        ])
        let session = session(transport)
        let signIn = session.makeSignIn()
        signIn.email = " ada@example.com "
        signIn.password = "secret"
        #expect(signIn.canSubmit)

        await signIn.submit()
        #expect(signIn.captchaSiteKey == "0x4AAAAAAA")
        #expect(signIn.problem == nil)

        await signIn.captchaSolved("turnstile-token")
        #expect(signIn.step == .secondFactor)
        #expect(transport.requests[2].headers["x-captcha-response"] == "turnstile-token")
        #expect(!signIn.canSubmit)

        signIn.code = "123456"
        await signIn.submit()
        #expect(session.state == .signedIn(SignedInUser(id: "usr_1", name: "Ada", email: "ada@example.com")))
        #expect(signIn.password.isEmpty && signIn.code.isEmpty)
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(transport.requests[0].body))
        #expect(body["email"] == .string("ada@example.com"))
    }

    @Test func explainsAWrongPasswordOrCode() async {
        let transport = StubTransport([
            .response(status: 401, chunks: [#"{"code":"INVALID_EMAIL_OR_PASSWORD"}"#]),
            .response(
                status: 200, headers: ["Set-Cookie": Cookies.twoFactor],
                chunks: [#"{"twoFactorRedirect":true}"#]),
            .response(status: 401, chunks: [#"{"code":"INVALID_CODE"}"#]),
            .response(status: 401, chunks: [#"{"code":"INVALID_TWO_FACTOR_COOKIE"}"#]),
        ])
        let signIn = session(transport).makeSignIn()
        signIn.email = "ada@example.com"
        signIn.password = "wrong"
        await signIn.submit()
        #expect(signIn.problem == .invalidCredentials)
        #expect(signIn.step == .credentials)
        #expect(signIn.password.isEmpty)

        signIn.password = "right"
        await signIn.submit()
        signIn.code = "000000"
        await signIn.submit()
        #expect(signIn.problem == .invalidCode)
        #expect(signIn.step == .secondFactor)

        await signIn.submit()
        #expect(signIn.problem == .signInExpired)
        #expect(signIn.step == .credentials)
    }

    @Test func sendsAPasswordResetLinkToTheWeb() async throws {
        let transport = StubTransport([.response(status: 200, chunks: [#"{"status":true}"#])])
        let signIn = session(transport).makeSignIn()
        signIn.email = "ada@example.com"
        await signIn.requestPasswordReset()
        #expect(signIn.resetEmailSent)
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(transport.requests[0].body))
        #expect(body["redirectTo"] == .string("https://app.teler.example/reset-password"))
    }

    @Test func restoresKeepsOrDropsASavedSession() async {
        let saved = StoredCookie(
            name: "__Secure-teler.session_token", value: "tok.sig", expires: Date(timeIntervalSinceNow: 3600))

        let valid = session(StubTransport([.response(status: 200, chunks: [user])]), store: MemorySessionStore([saved]))
        await valid.restore()
        #expect(valid.state == .signedIn(SignedInUser(id: "usr_1", name: "Ada", email: "ada@example.com")))

        let offline = session(StubTransport([.failure]), store: MemorySessionStore([saved]))
        await offline.restore()
        #expect(offline.state == .signedIn(nil))

        let store = MemorySessionStore([saved])
        let revoked = session(StubTransport([.response(status: 200, chunks: ["null"])]), store: store)
        await revoked.restore()
        #expect(revoked.state == .signedOut)
        #expect(store.load().isEmpty)

        let none = session(StubTransport([]))
        await none.restore()
        #expect(none.state == .signedOut)
    }

    @Test func signsOutOnTheServerAndTheDevice() async {
        let saved = StoredCookie(
            name: "__Secure-teler.session_token", value: "tok.sig", expires: Date(timeIntervalSinceNow: 3600))
        let store = MemorySessionStore([saved])
        let transport = StubTransport([
            .response(status: 200, chunks: [user]),
            .response(status: 200, chunks: [#"{"activeOrganizationId":"org_01jczpznh32py20pd8y10ef9cq"}"#]),
            .response(status: 200, headers: ["Set-Cookie": Cookies.sessionCleared], chunks: [#"{"success":true}"#]),
        ])
        let session = session(transport, store: store)
        await session.restore()
        await session.signOut()
        #expect(session.state == .signedOut)
        #expect(store.load().isEmpty)
        #expect(transport.requests.last?.url.path == "/api/auth/sign-out")
        #expect(transport.requests.last?.headers["Cookie"] == "__Secure-teler.session_token=tok.sig")
    }

    @Test func switchesToTheDemo() async throws {
        let session = session(StubTransport([]))
        session.startDemo()
        #expect(session.state == .demo)
        #expect(try await session.activeClient.chats().chats.count == 3)
    }
}
