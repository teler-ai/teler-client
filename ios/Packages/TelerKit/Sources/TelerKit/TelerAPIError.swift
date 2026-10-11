import Foundation

/// Errors are deliberately coarse. They never carry URLs, tokens or response
/// text from the server or the network stack, so they are safe to show and log.
public enum TelerAPIError: Error, Equatable, Sendable {
    case invalidEndpoint
    /// The request could not be completed (offline, DNS, TLS, timeout).
    case network
    case redirectRefused(status: Int)
    /// This app version is too old for the server (HTTP 426).
    case updateRequired(minimumVersion: String?)
    case http(status: Int, code: String?, retryAfter: Duration?)
    case invalidResponse
    case responseTooLarge

    public var isUnauthorized: Bool {
        if case .http(401, _, _) = self { return true }
        return false
    }

    static let maximumRetryAfter = Duration.seconds(15 * 60)

    /// Maps a non-success response. Only an error `code` made of capitals,
    /// digits and underscores and a numeric `minVersion` are read from the body.
    static func from(head: HTTPResponseHead, body: Data) -> TelerAPIError {
        let json = try? JSONDecoder().decode(JSONValue.self, from: body)
        // Better Auth puts the code at the top level; Teler's own routes may
        // nest it as `{ "error": { "code" } }`.
        let code = (json?["code"] ?? json?["error"]?["code"])?.stringValue.flatMap(Self.safeCode)
        if code == "CLIENT_UPDATE_REQUIRED" {
            let minimum = json?["minVersion"]?.stringValue.flatMap {
                ClientIdentity.isVersion($0) ? $0 : nil
            }
            return .updateRequired(minimumVersion: minimum)
        }
        return .http(
            status: head.statusCode, code: code,
            retryAfter: head.header("Retry-After").flatMap(Self.retryAfter))
    }

    private static func safeCode(_ value: String) -> String? {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")
        guard (1...64).contains(value.count), value.allSatisfy({ allowed.contains($0) }) else {
            return nil
        }
        return value
    }

    private static func retryAfter(_ value: String) -> Duration? {
        guard let seconds = Double(value.trimmingCharacters(in: .whitespaces)),
            seconds.isFinite, seconds >= 0
        else { return nil }
        return min(.milliseconds(Int64(seconds * 1000)), maximumRetryAfter)
    }
}
