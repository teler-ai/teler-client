import Foundation

/// The Teler origin the app talks to, such as `https://app.teler.ai`.
/// HTTPS is required except on loopback, matching the CLI.
public struct TelerOrigin: Sendable, Hashable, CustomStringConvertible {
    public enum Invalid: Error, Equatable {
        case notAnOrigin
        case insecure
    }

    private let scheme: String
    private let host: String
    private let port: Int?

    public init(_ string: String) throws {
        guard let components = URLComponents(string: string),
            let scheme = components.scheme?.lowercased(),
            let host = components.host?.lowercased(), !host.isEmpty,
            components.user == nil, components.password == nil,
            components.query == nil, components.fragment == nil,
            components.path.isEmpty || components.path == "/"
        else { throw Invalid.notAnOrigin }
        let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
        guard scheme == "https" || (scheme == "http" && loopback) else { throw Invalid.insecure }
        self.scheme = scheme
        self.host = host
        self.port = components.port
    }

    public var description: String {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = port
        return components.string ?? ""
    }

    /// Builds a URL on this origin. Paths must be absolute and must not try to
    /// leave the origin or walk up the path.
    public func url(path: String, query: [URLQueryItem] = []) throws -> URL {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
            !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." })
        else { throw TelerAPIError.invalidEndpoint }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = port
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw TelerAPIError.invalidEndpoint }
        return url
    }
}

/// How the app names itself to Teler in `Teler-Client` and `User-Agent`, so the
/// server can require an update (HTTP 426) when an old version no longer fits.
public struct ClientIdentity: Sendable, Hashable {
    public let name: String
    public let version: String

    public init?(name: String, version: String) {
        let nameCharacters = Set("abcdefghijklmnopqrstuvwxyz0123456789-")
        guard let first = name.first, first.isLowercase, first.isASCII, name.count <= 32,
            name.allSatisfy({ nameCharacters.contains($0) })
        else { return nil }
        guard Self.isVersion(version) else { return nil }
        self.name = name
        self.version = version
    }

    /// `major.minor.patch`, each one to six ASCII digits.
    public static func isVersion(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 3
            && parts.allSatisfy { part in
                (1...6).contains(part.count) && part.allSatisfy { $0.isASCII && $0.isNumber }
            }
    }

    public var headerValue: String { "\(name)/\(version)" }
}
