import TelerKit

/// What went wrong, in terms the app can explain. The app localizes the
/// message; nothing here carries server or network text.
public enum Problem: Error, Sendable, Equatable {
    case offline
    case updateRequired
    case signedOut
    case forbidden
    case notFound
    case streamStopped
    case noOrganization
    case invalidCredentials
    case emailNotVerified
    case invalidCode
    /// The two-factor step took too long; sign in again.
    case signInExpired
    case tooManyAttempts
    case captchaRequired
    case captchaFailed
    /// The account hasn't finished its welcome step on the web.
    case registrationRequired
    case other

    public init(_ error: Error) {
        switch error {
        case let problem as Problem: self = problem
        case TelerAPIError.network: self = .offline
        case TelerAPIError.updateRequired: self = .updateRequired
        case TelerAPIError.http(let status, let code, _):
            self = code.flatMap(Self.byCode) ?? Self.byStatus(status)
        case is TaskStreamError: self = .streamStopped
        default: self = .other
        }
    }

    private static func byCode(_ code: String) -> Problem? {
        switch code {
        case "INVALID_EMAIL_OR_PASSWORD": .invalidCredentials
        case "EMAIL_NOT_VERIFIED": .emailNotVerified
        case "INVALID_CODE", "INVALID_BACKUP_CODE", "OTP_HAS_EXPIRED": .invalidCode
        case "INVALID_TWO_FACTOR_COOKIE": .signInExpired
        case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "ACCOUNT_TEMPORARILY_LOCKED": .tooManyAttempts
        case "MISSING_RESPONSE": .captchaRequired
        case "VERIFICATION_FAILED": .captchaFailed
        case "REGISTRATION_REQUIRED": .registrationRequired
        default: nil
        }
    }

    private static func byStatus(_ status: Int) -> Problem {
        switch status {
        case 401: .signedOut
        case 403: .forbidden
        case 404: .notFound
        case 429: .tooManyAttempts
        default: .other
        }
    }
}
