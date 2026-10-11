import Foundation
import TelerKit

/// In debug builds launch arguments can choose the server and open a screen
/// directly, so scripts can photograph it:
///
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute chat:<chat id>
///     xcrun simctl launch <device> ai.teler.app -TelerDemo YES -TelerRoute "ask:<question>"
///     xcrun simctl launch <device> ai.teler.app -TelerOrigin https://<teler origin>
enum DebugRoute: Equatable {
    case chat(ChatID)
    case ask(String)

    static var atLaunch: DebugRoute? {
        #if DEBUG
            guard let value = UserDefaults.standard.string(forKey: "TelerRoute") else { return nil }
            if value.hasPrefix("chat:"), let chat = ChatID(rawValue: String(value.dropFirst(5))) {
                return .chat(chat)
            }
            if value.hasPrefix("ask:"), value.count > 4 { return .ask(String(value.dropFirst(4))) }
        #endif
        return nil
    }

    /// Opens the demo instead of the sign-in screen.
    static var startsInDemo: Bool {
        #if DEBUG
            return UserDefaults.standard.bool(forKey: "TelerDemo")
        #else
            return false
        #endif
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
