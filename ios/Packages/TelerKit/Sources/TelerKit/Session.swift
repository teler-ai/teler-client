import Foundation
import Synchronization

/// A cookie Teler set for the app's origin.
public struct StoredCookie: Sendable, Hashable, Codable {
    public let name: String
    public let value: String
    public let expires: Date?

    public init(name: String, value: String, expires: Date?) {
        self.name = name
        self.value = value
        self.expires = expires
    }
}

/// Where the session survives app restarts. The app keeps it in the Keychain.
public protocol SessionStore: Sendable {
    func load() -> [StoredCookie]
    func save(_ cookies: [StoredCookie])
    func clear()
}

/// Keeps the cookies Teler's server sets, the way a browser keeps them for
/// one site, so the app's session is the same kind of session as the web's.
///
/// Every cookie is sent back to the origin that set it. Cookies with an expiry
/// are saved to the `SessionStore`, except the short-lived two-factor cookie
/// that only bridges the password and code steps of a sign-in.
public actor CookieJar {
    private var cookies: [String: StoredCookie] = [:]
    private let store: (any SessionStore)?

    public init(store: (any SessionStore)? = nil) {
        self.store = store
        let now = Date()
        for cookie in store?.load() ?? [] where cookie.expires.map({ $0 > now }) ?? false {
            cookies[cookie.name] = cookie
        }
    }

    /// Whether a Teler session cookie is present (it may still have been revoked).
    public var hasSession: Bool {
        let now = Date()
        return cookies.values.contains { cookie in
            cookie.name.hasSuffix(".session_token") && cookie.expires.map { $0 > now } ?? true
        }
    }

    /// The `Cookie` header for the next request, or nil when there are none.
    public func headerValue(now: Date = Date()) -> String? {
        let live = cookies.values
            .filter { $0.expires.map { $0 > now } ?? true }
            .sorted { $0.name < $1.name }
        return live.isEmpty ? nil : live.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
    }

    /// Applies a response's `Set-Cookie` header, which may combine several
    /// cookies. A cookie that is empty or already expired is removed.
    public func update(setCookie header: String, now: Date = Date()) {
        let received = SetCookie.parse(header, now: now)
        guard !received.isEmpty else { return }
        for cookie in received {
            cookies[cookie.name] =
                cookie.isExpired
                ? nil : StoredCookie(name: cookie.name, value: cookie.value, expires: cookie.expires)
        }
        persist()
    }

    public func clear() {
        cookies.removeAll()
        store?.clear()
    }

    private func persist() {
        let durable = cookies.values.filter { $0.expires != nil && !$0.name.hasSuffix(".two_factor") }
        if durable.isEmpty {
            store?.clear()
        } else {
            store?.save(durable.sorted { $0.name < $1.name })
        }
    }
}

/// Parses `Set-Cookie` the way browsers do for the parts the app needs: the
/// name, the value and when it expires (`Max-Age` wins over `Expires`).
/// Foundation's parser is not used because on Linux it ignores `Max-Age`.
enum SetCookie {
    struct Cookie: Equatable {
        let name: String
        let value: String
        let expires: Date?
        let isExpired: Bool
    }

    /// URLSession joins repeated `Set-Cookie` headers with commas, and
    /// `Expires` dates contain commas too.
    static func parse(_ header: String, now: Date) -> [Cookie] {
        var raw: [String] = []
        for piece in header.split(separator: ",", omittingEmptySubsequences: false) {
            let trimmed = piece.drop(while: { $0 == " " })
            if raw.isEmpty || startsCookie(trimmed) {
                raw.append(String(trimmed))
            } else {
                raw[raw.count - 1] += "," + piece
            }
        }
        return raw.compactMap { parseOne($0, now: now) }
    }

    private static func startsCookie(_ text: Substring) -> Bool {
        guard let equals = text.firstIndex(of: "=") else { return false }
        let name = text[..<equals]
        return !name.isEmpty && !name.contains { $0 == ";" || $0 == " " }
    }

    private static func parseOne(_ text: String, now: Date) -> Cookie? {
        let parts = text.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let pair = parts.first, let equals = pair.firstIndex(of: "=") else { return nil }
        let name = String(pair[..<equals])
        let value = String(pair[pair.index(after: equals)...])
        guard !name.isEmpty else { return nil }
        var maxAge: Int?
        var expires: Date?
        for attribute in parts.dropFirst() {
            let field = attribute.split(separator: "=", maxSplits: 1).map(String.init)
            switch field.first?.lowercased() {
            case "max-age": maxAge = field.count == 2 ? Int(field[1]) : nil
            case "expires": expires = field.count == 2 ? httpDate(field[1]) : nil
            default: break
            }
        }
        let expiry = maxAge.map { now.addingTimeInterval(TimeInterval($0)) } ?? expires
        return Cookie(
            name: name, value: value, expires: expiry,
            isExpired: value.isEmpty || expiry.map { $0 <= now } ?? false)
    }

    private static func httpDate(_ text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        for format in ["EEE, dd MMM yyyy HH:mm:ss zzz", "EEE, dd-MMM-yyyy HH:mm:ss zzz"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: text) { return date }
        }
        return nil
    }
}

/// Keeps the session only while the app runs, for previews and tests.
public final class MemorySessionStore: SessionStore {
    private let cookies: Mutex<[StoredCookie]>

    public init(_ cookies: [StoredCookie] = []) { self.cookies = Mutex(cookies) }

    public func load() -> [StoredCookie] { cookies.withLock { $0 } }
    public func save(_ cookies: [StoredCookie]) { self.cookies.withLock { $0 = cookies } }
    public func clear() { cookies.withLock { $0 = [] } }
}
