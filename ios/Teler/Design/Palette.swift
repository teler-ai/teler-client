import SwiftUI
import UIKit

/// Teler's Golden Loom colors for light and dark, under the names the web
/// app's design tokens use (`packages/ui/src/styles/globals.css` in the Teler
/// repository), resolved to the values the iPhone design uses. The `ios`
/// colors exist only on iPhone.
///
/// Amber (`primary`) is an accent for fills. Text, links and focus rings use
/// `primaryInk`, which is legible on light backgrounds.
enum Palette {
    static let background = Color(light: 0xFAF8F5, dark: 0x0B0401)
    static let foreground = Color(light: 0x222222, dark: 0xF4EEE4)
    static let card = Color(light: 0xFFFFFF, dark: 0x150A04)
    static let primary = Color(light: 0xD1A84B, dark: 0xEFA810)
    static let primaryForeground = Color(light: 0x222222, dark: 0x070200)
    static let primaryInk = Color(light: 0x7C673C, dark: 0xEFA810)
    static let secondary = Color(light: 0xF4F1EC, dark: 0x1D140D)
    static let muted = Color(light: 0xEEEBE5, dark: 0x17100B)
    static let mutedForeground = Color(light: 0x6E685C, dark: 0xB0A290)
    static let accent = Color(light: 0x799979, dark: 0x69BA7C)
    static let destructive = Color(light: 0xE7000B, dark: 0xFF2335)
    static let success = Color(light: 0x51A556, dark: 0x54B66E)
    static let warning = Color(light: 0xD78D00, dark: 0xEFA810)
    static let border = Color(light: 0xE1DED7, dark: 0x32261C)
    /// The style's eight series colors (`--chart-1` to `--chart-8`).
    static let charts = [
        Color(light: 0xB7810F, dark: 0xC08810), Color(light: 0x176938, dark: 0x378450),
        Color(light: 0x3951A0, dark: 0x5F7BCE), Color(light: 0xB14935, dark: 0xC55C46),
        Color(light: 0x008D85, dark: 0x1AA79F), Color(light: 0x844500, dark: 0xA15F26),
        Color(light: 0x7A892B, dark: 0x8D9D40), Color(light: 0x873F75, dark: 0xA75C93),
    ]
    /// Neutral tones for series without a color of their own (`--chart-rest-1` to `-3`).
    static let chartsRest = [
        Color(light: 0xB2ADA5, dark: 0x6F6254), Color(light: 0x938E84, dark: 0x8F8171),
        Color(light: 0xC8C5BE, dark: 0x574A3E),
    ]

    /// Secondary text in rows and placeholders.
    static let tertiary = Color(light: 0x8E877A, dark: 0x8A7C6A)
    /// Icon tiles, chips and quiet controls.
    static let fill = Color(light: 0x6E685C, lightAlpha: 0.10, dark: 0xB0A290, darkAlpha: 0.14)
    static let fillStrong = Color(light: 0x6E685C, lightAlpha: 0.17, dark: 0xB0A290, darkAlpha: 0.22)
    /// The member's own messages.
    static let bubble = Color(light: 0xEEEBE5, dark: 0x1D140D)
    static let bubbleEdge = Color(light: 0xEEEBE5, lightAlpha: 0, dark: 0x32261C)
    static let avatar = Color(light: 0xFAF0D8, dark: 0x523E15)
    static let avatarInk = Color(light: 0x74591E, dark: 0xF5E0B0)
    static let avatarAlternate = Color(light: 0xE8EFEA, dark: 0x323D34)
    static let avatarAlternateInk = Color(light: 0x323D34, dark: 0xD1DFD5)
    /// Warning and destructive text and icons, legible in light mode too.
    static let warningInk = Color(light: 0x9A6200, dark: 0xEFA810)
    static let destructiveInk = Color(light: 0xC0000A, dark: 0xFF5A64)
}

extension Color {
    /// A color that follows the light or dark appearance.
    init(light: UInt32, lightAlpha: Double = 1, dark: UInt32, darkAlpha: Double = 1) {
        self.init(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(rgb: dark, alpha: darkAlpha) : UIColor(rgb: light, alpha: lightAlpha)
            })
    }
}

extension UIColor {
    convenience init(rgb: UInt32, alpha: Double = 1) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255, alpha: alpha)
    }
}
