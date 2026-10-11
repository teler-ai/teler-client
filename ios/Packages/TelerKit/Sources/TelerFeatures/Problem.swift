import TelerKit

/// What went wrong, in terms the app can explain. The app localizes the
/// message; nothing here carries server or network text.
public enum Problem: Sendable, Equatable {
    case offline
    case updateRequired
    case signedOut
    case forbidden
    case notFound
    case streamStopped
    case noOrganization
    case other

    public init(_ error: Error) {
        switch error {
        case TelerAPIError.network: self = .offline
        case TelerAPIError.updateRequired: self = .updateRequired
        case TelerAPIError.http(401, _, _): self = .signedOut
        case TelerAPIError.http(403, _, _): self = .forbidden
        case TelerAPIError.http(404, _, _): self = .notFound
        case is TaskStreamError: self = .streamStopped
        default: self = .other
        }
    }
}
