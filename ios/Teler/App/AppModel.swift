import Foundation
import Observation
import TelerDemo
import TelerFeatures
import TelerKit

/// What the whole app shares: the API client and whether it shows demo data.
@MainActor @Observable
final class AppModel {
    let client: TelerAPIClient
    let isDemo: Bool

    init() {
        // Signing in arrives with the mobile session. Until then the app runs
        // on the offline demo API, which speaks the same protocol as Teler.
        client = TelerAPIClient(
            origin: DemoTransport.origin, identity: .app, transport: DemoTransport())
        isDemo = true
    }

    /// The same chat in the web app, for parts the app cannot show yet.
    func webURL(for chat: ChatID) -> URL? {
        isDemo ? nil : try? client.origin.url(path: "/chat/\(chat.rawValue)")
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
        case .other:
            String(localized: "Something went wrong. Try again.")
        }
    }
}
