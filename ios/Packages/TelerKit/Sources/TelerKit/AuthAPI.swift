import Foundation

/// The signed-in person, as Teler's session endpoint describes them.
public struct SignedInUser: Sendable, Hashable, Decodable {
    public let id: String
    public let name: String?
    public let email: String?

    public init(id: String, name: String?, email: String?) {
        self.id = id
        self.name = name
        self.email = email
    }
}

public enum SignInResult: Sendable, Equatable {
    case signedIn
    /// The account uses two-factor authentication; finish with
    /// `verifySecondFactor`, which reuses the cookie this step set.
    case secondFactorRequired
}

public enum SecondFactor: Sendable, Equatable {
    case authenticatorCode
    case backupCode
}

/// Teler's existing auth endpoints, called as the web app calls them. With
/// `Authentication.session` the resulting cookies land in the client's jar.
extension TelerAPIClient {
    /// Signs in with email and password. `captcha` is the Turnstile token,
    /// needed only when the server asks for one (`MISSING_RESPONSE`).
    public func signIn(email: String, password: String, captcha: String? = nil) async throws
        -> SignInResult
    {
        struct Body: Encodable {
            let email: String
            let password: String
            let rememberMe = true
        }
        struct Outcome: Decodable { let twoFactorRedirect: Bool? }
        let outcome = try await json(
            Outcome.self, .post, "/api/auth/sign-in/email", headers: Self.captchaHeaders(captcha),
            body: try Self.encode(Body(email: email, password: password)))
        if outcome.twoFactorRedirect == true { return .secondFactorRequired }
        try await requireSession()
        return .signedIn
    }

    /// Completes a two-factor sign-in with an authenticator or backup code.
    public func verifySecondFactor(_ code: String, using factor: SecondFactor, trustDevice: Bool)
        async throws
    {
        struct Body: Encodable {
            let code: String
            let trustDevice: Bool
        }
        let path =
            factor == .authenticatorCode
            ? "/api/auth/two-factor/verify-totp" : "/api/auth/two-factor/verify-backup-code"
        _ = try await json(
            JSONValue.self, .post, path,
            body: try Self.encode(Body(code: code, trustDevice: trustDevice)))
        try await requireSession()
    }

    /// Emails a reset link that opens Teler on the web.
    public func requestPasswordReset(email: String, captcha: String? = nil) async throws {
        struct Body: Encodable {
            let email: String
            let redirectTo: String
        }
        _ = try await json(
            JSONValue.self, .post, "/api/auth/request-password-reset",
            headers: Self.captchaHeaders(captcha),
            body: try Self.encode(Body(email: email, redirectTo: "\(origin)/reset-password")))
    }

    /// The signed-in person, or nil when the session is missing or has ended.
    public func currentUser() async throws -> SignedInUser? {
        struct Session: Decodable { let user: SignedInUser }
        let session = try await json(JSONValue.self, .get, "/api/auth/get-session")
        guard case .object = session else { return nil }
        do {
            return try Self.makeDecoder().decode(
                Session.self, from: JSONEncoder().encode(session)
            ).user
        } catch {
            throw TelerAPIError.invalidResponse
        }
    }

    public func signOut() async throws {
        _ = try await json(JSONValue.self, .post, "/api/auth/sign-out", body: Data("{}".utf8))
    }

    /// The Turnstile site key Teler's web pages publish, if captcha is on.
    public func captchaSiteKey() async throws -> String? {
        let response = try await send(.get, "/", accept: "text/html")
        let html = String(decoding: try await response.collectBody(limit: 2 * 1024 * 1024), as: UTF8.self)
        return Self.metaContent(named: "teler-turnstile-site-key", in: html)
    }

    static func metaContent(named name: String, in html: String) -> String? {
        guard let tag = html.range(of: "<meta name=\"\(name)\" content=\"") else { return nil }
        let rest = html[tag.upperBound...]
        guard let end = rest.firstIndex(of: "\"") else { return nil }
        let value = String(rest[..<end])
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
        guard (1...128).contains(value.count), value.allSatisfy({ allowed.contains($0) }) else {
            return nil
        }
        return value
    }

    private static func captchaHeaders(_ token: String?) -> [String: String] {
        token.map { ["x-captcha-response": $0] } ?? [:]
    }

    private func requireSession() async throws {
        if case .session(let jar) = authentication, !(await jar.hasSession) {
            throw TelerAPIError.invalidResponse
        }
    }
}
