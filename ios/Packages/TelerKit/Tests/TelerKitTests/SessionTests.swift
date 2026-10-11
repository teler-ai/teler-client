import Foundation
import Testing

@testable import TelerKit

@Suite struct CookieJarTests {
    @Test func keepsTheSessionCookieAndSendsItBack() async {
        let jar = CookieJar()
        await jar.update(setCookie: Cookies.session)
        #expect(await jar.hasSession)
        #expect(await jar.headerValue() == "__Secure-teler.session_token=tok.sig")
    }

    @Test func readsSeveralCookiesFromOneCombinedHeader() async {
        // URLSession joins repeated Set-Cookie headers with ", ", and dates
        // contain commas too.
        let jar = CookieJar()
        let combined =
            "a.session_token=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/, a.trust_device=2; Max-Age=2592000; Path=/"
        await jar.update(setCookie: combined)
        #expect(await jar.headerValue() == "a.session_token=1; a.trust_device=2")
    }

    @Test func removesACookieTheServerExpires() async {
        let jar = CookieJar()
        await jar.update(setCookie: Cookies.session)
        await jar.update(setCookie: Cookies.sessionCleared)
        #expect(await !jar.hasSession)
        #expect(await jar.headerValue() == nil)
    }

    @Test func savesTheSessionButNotTheTwoFactorStep() async {
        let store = MemorySessionStore()
        let jar = CookieJar(store: store)
        await jar.update(setCookie: Cookies.twoFactor)
        #expect(store.load().isEmpty)
        await jar.update(setCookie: Cookies.session)
        await jar.update(setCookie: "a.browser_only=1; Path=/")
        #expect(store.load().map(\.name) == ["__Secure-teler.session_token"])

        let restored = CookieJar(store: store)
        #expect(await restored.hasSession)
        await restored.clear()
        #expect(store.load().isEmpty)
    }

    @Test func honorsMaxAgeBeforeExpires() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let cookies = SetCookie.parse(
            "a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Max-Age=60, b=2; Expires=Thu, 01 Jan 1970 00:00:00 GMT, c=3",
            now: now)
        #expect(cookies.map(\.name) == ["a", "b", "c"])
        #expect(cookies[0].expires == now.addingTimeInterval(60))
        #expect(cookies[1].isExpired)
        #expect(cookies[2].expires == nil && !cookies[2].isExpired)
    }

    @Test func ignoresASavedSessionThatHasExpired() async {
        let store = MemorySessionStore([
            StoredCookie(name: "a.session_token", value: "old", expires: Date(timeIntervalSinceNow: -60))
        ])
        #expect(await !CookieJar(store: store).hasSession)
    }
}

@Suite struct AuthAPITests {
    @Test func signsInWithTheWebSessionAndSendsItAfterwards() async throws {
        let transport = StubTransport([
            .response(
                status: 200, headers: ["Set-Cookie": Cookies.session],
                chunks: [#"{"redirect":false,"token":"tok","user":{"id":"usr_1"}}"#]),
            .response(status: 200, chunks: [#"{"chats":[],"total":0,"hasMore":false}"#]),
        ])
        let jar = CookieJar()
        let client = TelerAPIClient.session(transport, jar: jar)
        #expect(try await client.signIn(email: "ada@example.com", password: "secret") == .signedIn)
        _ = try await client.chats()

        let signIn = transport.requests[0]
        #expect(signIn.url.path == "/api/auth/sign-in/email")
        #expect(signIn.headers["Origin"] == "https://app.teler.example")
        #expect(signIn.headers["Cookie"] == nil)
        #expect(signIn.headers["x-captcha-response"] == nil)
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(signIn.body))
        #expect(body["rememberMe"] == .bool(true))
        #expect(transport.requests[1].headers["Cookie"] == "__Secure-teler.session_token=tok.sig")
        #expect(transport.requests[1].headers["Authorization"] == nil)
    }

    @Test func finishesATwoFactorSignInWithTheStepCookie() async throws {
        let transport = StubTransport([
            .response(
                status: 200, headers: ["Set-Cookie": Cookies.twoFactor],
                chunks: [#"{"twoFactorRedirect":true,"twoFactorMethods":["totp"]}"#]),
            .response(
                status: 200, headers: ["Set-Cookie": Cookies.session],
                chunks: [#"{"token":"tok","user":{"id":"usr_1"}}"#]),
        ])
        let jar = CookieJar()
        let client = TelerAPIClient.session(transport, jar: jar)
        #expect(
            try await client.signIn(email: "ada@example.com", password: "secret", captcha: "turnstile")
                == .secondFactorRequired)
        #expect(await !jar.hasSession)
        try await client.verifySecondFactor("123456", using: .authenticatorCode, trustDevice: true)

        #expect(transport.requests[0].headers["x-captcha-response"] == "turnstile")
        let verify = transport.requests[1]
        #expect(verify.url.path == "/api/auth/two-factor/verify-totp")
        #expect(verify.headers["Cookie"] == "__Secure-teler.two_factor=pending.sig")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(verify.body))
        #expect(body["code"] == .string("123456"))
        #expect(body["trustDevice"] == .bool(true))
        #expect(await jar.hasSession)
    }

    @Test func refusesASignInThatSetNoSession() async {
        let transport = StubTransport([.response(status: 200, chunks: [#"{"redirect":false}"#])])
        await #expect(throws: TelerAPIError.invalidResponse) {
            _ = try await TelerAPIClient.session(transport, jar: CookieJar()).signIn(
                email: "ada@example.com", password: "secret")
        }
    }

    @Test func readsTheCurrentUserOrNone() async throws {
        let transport = StubTransport([
            .response(
                status: 200,
                chunks: [#"{"session":{"id":"ses_1"},"user":{"id":"usr_1","name":"Ada","email":"ada@example.com"}}"#]),
            .response(status: 200, chunks: ["null"]),
        ])
        let client = TelerAPIClient.session(transport, jar: CookieJar())
        #expect(try await client.currentUser() == SignedInUser(id: "usr_1", name: "Ada", email: "ada@example.com"))
        #expect(try await client.currentUser() == nil)
    }

    @Test func readsNestedErrorCodes() async {
        let transport = StubTransport([
            .response(status: 403, chunks: [#"{"success":false,"error":{"code":"REGISTRATION_REQUIRED","message":"x"}}"#])
        ])
        await #expect(throws: TelerAPIError.http(status: 403, code: "REGISTRATION_REQUIRED", retryAfter: nil)) {
            _ = try await TelerAPIClient.session(transport, jar: CookieJar()).chats()
        }
    }

    @Test func readsOnlyAPlainCaptchaSiteKeyFromTheWebPage() {
        let page = #"<head><meta name="teler-turnstile-site-key" content="0x4AAAAAAA_b-1"></head>"#
        #expect(TelerAPIClient.metaContent(named: "teler-turnstile-site-key", in: page) == "0x4AAAAAAA_b-1")
        let injected = #"<meta name="teler-turnstile-site-key" content="x&quot;><script>">"#
        #expect(TelerAPIClient.metaContent(named: "teler-turnstile-site-key", in: injected) == nil)
        #expect(TelerAPIClient.metaContent(named: "teler-turnstile-site-key", in: "<head></head>") == nil)
    }
}
