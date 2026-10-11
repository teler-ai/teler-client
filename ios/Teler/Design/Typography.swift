import CoreText
import SwiftUI
import UIKit

/// Fraunces, Teler's display face, sets large titles and one brand headline
/// size; everything else uses the system font. The bundled file is the one the
/// web app ships (`@fontsource-variable/fraunces`, Latin, SIL Open Font
/// License in `Fraunces-OFL.txt`): a variable font with weight and optical
/// size axes.
@MainActor
enum Typeface {
    private static let name = "Fraunces-Regular"
    private static let weightAxis = 0x7767_6874  // 'wght'
    private static let opticalSizeAxis = 0x6F70_737A  // 'opsz'

    /// Makes Fraunces available to this app and sets navigation large titles
    /// in it. Call once at launch.
    static func setUp() {
        if let url = Bundle.main.url(forResource: "Fraunces", withExtension: "woff2") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        UINavigationBar.appearance().largeTitleTextAttributes = [
            .font: fraunces(34, relativeTo: .largeTitle),
            .kern: -0.34,
            .foregroundColor: UIColor(Palette.foreground),
        ]
    }

    /// Fraunces at `size` points scaled for the current text size like
    /// `style`, at weight 600 and the optical size of the scaled size.
    static func fraunces(
        _ size: CGFloat, relativeTo style: UIFont.TextStyle,
        traits: UITraitCollection? = nil
    ) -> UIFont {
        let scaled = UIFontMetrics(forTextStyle: style).scaledValue(for: size, compatibleWith: traits)
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: name,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [
                weightAxis: 600, opticalSizeAxis: min(max(scaled, 9), 144),
            ],
        ])
        return UIFont(descriptor: descriptor, size: scaled)
    }
}

extension View {
    /// Sets text in Fraunces, following the text size like `style`: 34 points
    /// for large titles, 28 for brand headlines.
    func displayFont(_ size: CGFloat, relativeTo style: UIFont.TextStyle) -> some View {
        modifier(DisplayFont(size: size, style: style))
    }
}

private struct DisplayFont: ViewModifier {
    let size: CGFloat
    let style: UIFont.TextStyle
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func body(content: Content) -> some View {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize))
        content
            .font(Font(Typeface.fraunces(size, relativeTo: style, traits: traits)))
            .kerning(-0.01 * size)
    }
}
