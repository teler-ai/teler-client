import Foundation

/// How a chart's series take their colors, saved with the chart
/// (`config.appearance`). The rules are the web's
/// (`packages/ui/src/lib/chart-palettes.ts` in the Teler repository), so a
/// series has the same color on every screen: a saved registry keeps each
/// series in its slot, focus colors only the named series, and overrides pin
/// exact colors.
public struct ChartAppearance: Sendable, Hashable {
    public enum Palette: Sendable, Hashable {
        /// A Teler style palette or a named categorical scheme, such as `tableau10`.
        case named(String)
        case custom([UInt32])
    }

    public var palette: Palette?
    public var reverse: Bool
    /// Category keys in palette slot order, append-only.
    public var domain: [String]?
    public var overrides: [String: UInt32]
    /// The only keys that keep a color, in slot order.
    public var focus: [String]?

    public init(
        palette: Palette? = nil, reverse: Bool = false, domain: [String]? = nil,
        overrides: [String: UInt32] = [:], focus: [String]? = nil
    ) {
        self.palette = palette
        self.reverse = reverse
        self.domain = domain
        self.overrides = overrides
        self.focus = focus
    }

    public init(json: JSONValue?) {
        switch json?["palette"] {
        case .string(let name)?: palette = .named(name)
        case .object?: palette = .custom(json?["palette"]?["colors"]?.arrayValue?.compactMap(Self.hex) ?? [])
        default: palette = nil
        }
        reverse = json?["reverse"]?.boolValue == true
        domain = json?["domain"]?.arrayValue?.compactMap(\.stringValue)
        var overrides: [String: UInt32] = [:]
        if case .object(let pairs)? = json?["overrides"] {
            for (key, value) in pairs {
                if let color = Self.hex(value) { overrides[key] = color }
            }
        }
        self.overrides = overrides
        focus = json?["focus"]?.arrayValue?.compactMap(\.stringValue)
    }

    /// The number of colors in each categorical palette the web knows.
    /// Other names, such as sequential ones, fall back to the style's palette.
    public static let paletteSizes: [String: Int] = [
        "teler-golden-loom": 8, "teler-obrador": 8, "teler-modernisme": 8, "teler-dali": 8,
        "teler-llobregat": 8, "category10": 10, "accent": 8, "dark2": 8, "observable10": 10,
        "paired": 12, "pastel1": 9, "pastel2": 8, "set1": 9, "set2": 8, "set3": 12, "tableau10": 10,
    ]
    /// The style palette's colors (`--chart-1` to `--chart-8`).
    public static let styleSize = 8

    /// Colors for these series keys and the order a legend lists them.
    ///
    /// Without a saved registry, keys take slots in sorted order, as on the web.
    /// Pass `drawn: true` when each mark's color repeats its own category
    /// (a bar per category), so slots follow the drawing order instead.
    public func coloring(for keys: [String], drawn: Bool = false) -> ChartColoring {
        let unique = keys.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let domain = Self.paletteDomain(unique, retained: domain ?? (drawn ? unique : []))
        var colors: [String: SeriesColor] = [:]
        for key in unique { colors[key] = color(key, domain: domain) }
        let order = unique.sorted { a, b in
            let left = (isNeutral(a, domain: domain) ? 1 : 0, slot(a, domain: domain))
            let right = (isNeutral(b, domain: domain) ? 1 : 0, slot(b, domain: domain))
            return left < right
        }
        return ChartColoring(colors: colors, legendOrder: order)
    }

    /// Kept slots first, then keys not seen before in sorted order.
    static func paletteDomain(_ names: [String], retained: [String]) -> [String] {
        var domain: [String] = []
        for name in retained where !domain.contains(name) { domain.append(name) }
        let unseen = Set(names).subtracting(domain)
        return domain + unseen.sorted(by: Self.codeUnitOrder)
    }

    /// JavaScript's default string order: UTF-16 code units.
    static func codeUnitOrder(_ a: String, _ b: String) -> Bool {
        a.utf16.lexicographicallyPrecedes(b.utf16)
    }

    private var paletteSize: Int {
        switch palette {
        case .custom(let colors) where !colors.isEmpty: colors.count
        case .named(let name): Self.paletteSizes[name] ?? Self.styleSize
        default: Self.styleSize
        }
    }

    private func paletteColor(_ index: Int) -> SeriesColor {
        switch palette {
        case .custom(let colors) where !colors.isEmpty: .hex(colors[index])
        case .named(let name) where Self.paletteSizes[name] != nil: .palette(name, index)
        default: .palette(nil, index)
        }
    }

    private func identitySlot(_ key: String, domain: [String]) -> (slot: Int, size: Int) {
        if let registry = self.domain, let slot = registry.firstIndex(of: key) {
            return (slot, registry.count)
        }
        let all = Self.paletteDomain(domain + [key], retained: self.domain ?? domain)
        return (all.firstIndex(of: key) ?? 0, all.count)
    }

    /// Beyond the palette's size one slot is given up, so the rest read as one neutral group.
    private func coloredSlots(size: Int, capacity: Int) -> Int {
        size <= capacity ? capacity : max(1, capacity - 1)
    }

    private func neutralSlot(_ key: String, domain: [String]) -> Int? {
        let (slot, size) = identitySlot(key, domain: domain)
        if let focus, !focus.isEmpty {
            if let position = focus.firstIndex(of: key), position < paletteSize { return nil }
            return slot
        }
        let colored = coloredSlots(size: size, capacity: paletteSize)
        return slot < colored ? nil : slot - colored
    }

    private func isNeutral(_ key: String, domain: [String]) -> Bool {
        overrides[key] == nil && neutralSlot(key, domain: domain) != nil
    }

    private func slot(_ key: String, domain: [String]) -> Int {
        if let position = focus?.firstIndex(of: key) { return position }
        return identitySlot(key, domain: domain).slot
    }

    private func color(_ key: String, domain: [String]) -> SeriesColor {
        if let override = overrides[key] { return .hex(override) }
        if let neutral = neutralSlot(key, domain: domain) { return .neutral(neutral % 3) }
        let size = paletteSize
        if let focus, !focus.isEmpty, let position = focus.firstIndex(of: key) {
            return paletteColor(reverse ? size - 1 - position : position)
        }
        let (slot, count) = identitySlot(key, domain: domain)
        let span = count <= size ? size : coloredSlots(size: count, capacity: size)
        return paletteColor(reverse ? span - 1 - slot : slot)
    }

    private static func hex(_ value: JSONValue) -> UInt32? {
        guard let text = value.stringValue, text.count == 7, text.hasPrefix("#") else { return nil }
        return UInt32(text.dropFirst(), radix: 16)
    }
}

/// A series' color before the light or dark appearance resolves it.
public enum SeriesColor: Sendable, Hashable {
    /// A slot of the reader's style palette (`nil`) or of a named palette.
    case palette(String?, Int)
    case hex(UInt32)
    /// One of three neutral tones for series without a color of their own.
    case neutral(Int)
}

public struct ChartColoring: Sendable, Hashable {
    public let colors: [String: SeriesColor]
    /// Colored series first in slot order, then neutral ones.
    public let legendOrder: [String]

    public func color(_ key: String) -> SeriesColor {
        colors[key] ?? .palette(nil, 0)
    }
}

/// Category keys as the web stores them in a chart's appearance: a missing
/// value is distinct from every string.
public enum ChartCategory {
    public static let missing = "~missing"

    public static func key(_ value: JSONValue) -> String {
        if value == .null { return missing }
        return value.display.replacingOccurrences(of: "~", with: "~~")
            .replacingOccurrences(of: "\u{0}", with: "~0")
    }

    public static func label(_ key: String) -> String {
        if key == missing { return "—" }
        var label = ""
        var escaped = false
        for character in key {
            if escaped {
                label.append(character == "0" ? "\u{0}" : character)
                escaped = false
            } else if character == "~" {
                escaped = true
            } else {
                label.append(character)
            }
        }
        return label
    }
}
