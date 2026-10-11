/// A Teler identifier: a lowercase prefix, an underscore and 26 lowercase
/// Crockford base32 characters, for example `chat_01j9k3m4n5p6q7r8s9t0v1w2x3`.
/// The only way to make one is the validating `init?(rawValue:)`, which keeps
/// request paths free of injected segments.
public protocol TelerIdentifier: RawRepresentable, Hashable, Sendable, Codable,
    CustomStringConvertible where RawValue == String
{
    static var prefix: String { get }
}

extension TelerIdentifier {
    public var description: String { rawValue }
}

enum IdentifierFormat {
    private static let alphabet = Set("0123456789abcdefghjkmnpqrstvwxyz")

    static func isValid(_ value: String, prefix: String) -> Bool {
        guard value.hasPrefix(prefix + "_") else { return false }
        let body = value.dropFirst(prefix.count + 1)
        return body.count == 26 && body.allSatisfy { alphabet.contains($0) }
    }
}

public struct ChatID: TelerIdentifier {
    public static let prefix = "chat"
    public let rawValue: String
    public init?(rawValue: String) {
        guard IdentifierFormat.isValid(rawValue, prefix: Self.prefix) else { return nil }
        self.rawValue = rawValue
    }
}

public struct TaskID: TelerIdentifier {
    public static let prefix = "atask"
    public let rawValue: String
    public init?(rawValue: String) {
        guard IdentifierFormat.isValid(rawValue, prefix: Self.prefix) else { return nil }
        self.rawValue = rawValue
    }
}

public struct MessageID: TelerIdentifier {
    public static let prefix = "msg"
    public let rawValue: String
    public init?(rawValue: String) {
        guard IdentifierFormat.isValid(rawValue, prefix: Self.prefix) else { return nil }
        self.rawValue = rawValue
    }
}

public struct OrganizationID: TelerIdentifier {
    public static let prefix = "org"
    public let rawValue: String
    public init?(rawValue: String) {
        guard IdentifierFormat.isValid(rawValue, prefix: Self.prefix) else { return nil }
        self.rawValue = rawValue
    }
}
