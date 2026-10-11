import Foundation
import TelerKit

/// In debug builds a launch argument can open a screen directly, so scripts can
/// photograph it:
///
///     xcrun simctl launch <device> ai.teler.app -TelerRoute chat:<chat id>
///     xcrun simctl launch <device> ai.teler.app -TelerRoute "ask:<question>"
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
}
