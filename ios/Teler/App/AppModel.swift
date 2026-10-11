import Foundation
import Observation
import TelerDemo
import TelerFeatures
import TelerKit

/// What the whole app shares: the session and the client behind the screens.
@MainActor @Observable
final class AppModel {
    let session: SessionModel

    init() {
        let origin = DebugRoute.origin ?? (try! TelerOrigin("https://app.teler.ai"))
        session = SessionModel(
            origin: origin, identity: .app, transport: URLSessionTransport(),
            store: KeychainSessionStore(origin: origin),
            demoClient: TelerAPIClient(
                origin: DemoTransport.origin, identity: .app, transport: DemoTransport()))
    }

    var client: TelerAPIClient { session.activeClient }
    var isDemo: Bool { session.state == .demo }

    /// The language the app shows, for text Teler writes, such as starter questions.
    let language = Bundle.main.preferredLocalizations.first ?? "en"

    /// The same page in the web app.
    func webURL(path: String) -> URL? {
        try? session.client.origin.url(path: path)
    }

    /// The same chat in the web app, for parts the app cannot show yet.
    func webURL(for chat: ChatID) -> URL? {
        isDemo ? nil : webURL(path: "/chat/\(chat.rawValue)")
    }
}

extension ClientIdentity {
    static let app: ClientIdentity = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return ClientIdentity(name: "teler-ios", version: version ?? "")
            ?? ClientIdentity(name: "teler-ios", version: "0.0.0")!
    }()
}

extension Problem {
    var message: String {
        switch self {
        case .offline:
            String(localized: "Teler can't be reached. Check your connection and try again.")
        case .updateRequired:
            String(localized: "This version of Teler is no longer supported. Update the app to continue.")
        case .signedOut:
            String(localized: "Your session has ended. Sign in again.")
        case .forbidden:
            String(localized: "You don't have access to this.")
        case .notFound:
            String(localized: "This chat no longer exists.")
        case .streamStopped:
            String(localized: "The answer stopped updating. Pull to refresh to see the latest.")
        case .noOrganization:
            String(localized: "Choose an organization in Teler on the web first.")
        case .invalidCredentials:
            String(localized: "That email and password don't match.")
        case .emailNotVerified:
            String(localized: "Confirm your email first. We've sent you a new link.")
        case .invalidCode:
            String(localized: "That code didn't work. Check it and try again.")
        case .signInExpired:
            String(localized: "That took too long. Sign in again.")
        case .tooManyAttempts:
            String(localized: "Too many attempts. Wait a few minutes and try again.")
        case .captchaRequired, .captchaFailed:
            String(localized: "The security check didn't complete. Try again.")
        case .registrationRequired:
            String(localized: "Finish setting up your account on the web, then come back.")
        case .other:
            String(localized: "Something went wrong. Try again.")
        }
    }
}
