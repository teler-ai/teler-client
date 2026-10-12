import Foundation
import SwiftUI
import TelerFeatures
import TelerKit

/// In debug builds launch arguments can choose the server and open a screen
/// directly, so scripts can photograph it:
///
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute chat:<chat id>
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute "ask:<question>"
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute chart:<chat id>/<slug> \
///         -TelerChartState pick:7|focus:<series>|table
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute needs
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute tab:chats
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute new
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute "search:<text>"
///     xcrun simctl launch <device> ai.teler.app -TelerRoute screen:twofactor
///     xcrun simctl launch <device> ai.teler.app -TelerOrigin https://<teler origin>
enum DebugRoute: Equatable {
    case chat(ChatID)
    case ask(String)
    case tab(AppTab)
    case newChat
    case search(String)
    /// A sign-in or session screen, by name: `screen:twofactor`, `screen:backup`,
    /// `screen:wrong-password`, `screen:again`, `screen:setup` or `screen:update`.
    case screen(String)
    case dashboard(DashboardID)
    case settings
    /// A chat's chart, opened large.
    case chart(ChatID, slug: String)
    /// The first Agent finding in Needs you.
    case needsYou

    static var atLaunch: DebugRoute? {
        #if DEBUG
            guard let value = UserDefaults.standard.string(forKey: "TelerRoute") else { return nil }
            if value.hasPrefix("chat:"), let chat = ChatID(rawValue: String(value.dropFirst(5))) {
                return .chat(chat)
            }
            if value.hasPrefix("ask:"), value.count > 4 { return .ask(String(value.dropFirst(4))) }
            if value.hasPrefix("search:"), value.count > 7 { return .search(String(value.dropFirst(7))) }
            if value.hasPrefix("screen:"), value.count > 7 { return .screen(String(value.dropFirst(7))) }
            if value.hasPrefix("dashboard:"), let id = DashboardID(rawValue: String(value.dropFirst(10))) {
                return .dashboard(id)
            }
            if value.hasPrefix("chart:") {
                let parts = value.dropFirst(6).split(separator: "/", maxSplits: 1).map(String.init)
                if parts.count == 2, let chat = ChatID(rawValue: parts[0]) { return .chart(chat, slug: parts[1]) }
            }
            switch value {
            case "tab:home": return .tab(.home)
            case "tab:chats": return .tab(.chats)
            case "tab:dashboards": return .tab(.dashboards)
            case "tab:search": return .tab(.search)
            case "new": return .newChat
            case "settings": return .settings
            case "needs": return .needsYou
            default: break
            }
        #endif
        return nil
    }

    /// How a chart opened by `chart:` starts: `pick:<index>`, `focus:<series>` or `table`.
    static var chartState: String? {
        #if DEBUG
            return UserDefaults.standard.string(forKey: "TelerChartState")
        #else
            return nil
        #endif
    }

    /// Opens the demo instead of the sign-in screen.
    static var startsInDemo: Bool {
        #if DEBUG
            return UserDefaults.standard.bool(forKey: "TelerDemo")
        #else
            return false
        #endif
    }

    /// How long the demo waits between streamed parts, to photograph an answer being written.
    static var demoChunkDelay: Duration {
        #if DEBUG
            let milliseconds = UserDefaults.standard.integer(forKey: "TelerDemoDelay")
            if milliseconds > 0 { return .milliseconds(milliseconds) }
        #endif
        return .milliseconds(60)
    }

    /// Another Teler origin, such as a local stack.
    static var origin: TelerOrigin? {
        #if DEBUG
            return UserDefaults.standard.string(forKey: "TelerOrigin").flatMap { try? TelerOrigin($0) }
        #else
            return nil
        #endif
    }
}

#if DEBUG
    /// Sign-in and session screens in a given state, so scripts can photograph
    /// them without a server or typing.
    struct DebugScreen: View {
        let app: AppModel
        let name: String
        private let laia = SignedInUser(id: "usr_1", name: "Laia Puig", email: "laia@example.com")

        var body: some View {
            switch name {
            case "twofactor":
                SignInView(app: app) { $0.showSecondFactorForScreenshots() }
            case "backup":
                SignInView(app: app) {
                    $0.showSecondFactorForScreenshots()
                    $0.factor = .backupCode
                }
            case "wrong-password":
                SignInView(app: app) {
                    $0.email = laia.email ?? ""
                    $0.problem = .invalidCredentials
                }
            case "again":
                MainView(app: app)
                    .sheet(isPresented: .constant(true)) {
                        SignInView(app: app, mode: .again(email: laia.email))
                    }
            case "setup":
                FinishSetupView(app: app, user: laia)
            case "update":
                UpdateRequiredView()
            default:
                SignInView(app: app)
            }
        }
    }
#endif
