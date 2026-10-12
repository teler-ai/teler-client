import SwiftUI
import TelerKit

/// The colors behind a chart's series: Teler's style palettes in light and
/// dark, and the categorical schemes a chart can name, with the values the web
/// uses (`packages/ui/src/lib/chart-palettes-catalog.ts`).
enum ChartPalettes {
    static func color(_ color: SeriesColor) -> Color {
        switch color {
        case .palette(nil, let index):
            Palette.charts[index % Palette.charts.count]
        case .palette(let name?, let index):
            (named[name] ?? Palette.charts).wrapped(index)
        case .hex(let rgb):
            Color(uiColor: UIColor(rgb: rgb))
        case .neutral(let index):
            Palette.chartsRest.wrapped(index)
        }
    }

    private static func style(_ light: [UInt32], _ dark: [UInt32]) -> [Color] {
        zip(light, dark).map { Color(light: $0, dark: $1) }
    }

    private static func scheme(_ colors: [UInt32]) -> [Color] {
        colors.map { Color(uiColor: UIColor(rgb: $0)) }
    }

    private static let named: [String: [Color]] = [
        "teler-golden-loom": Palette.charts,
        "teler-obrador": style(
            [0xD01D21, 0x7241A0, 0x0396AF, 0xAA8A0A, 0x7F3E00, 0x077E3F, 0x0A58BB, 0xD76900],
            [0xEA3D38, 0x9565C7, 0x12A5C0, 0xB19005, 0x9B5824, 0x319D5A, 0x377EE3, 0xE26F06]),
        "teler-modernisme": style(
            [0x0E5CAF, 0x017952, 0xB08506, 0xCB5E6F, 0x0698A4, 0xB84A27, 0x6A51A4, 0x708C34],
            [0x3B81D7, 0x01A671, 0xB98C06, 0xD96A7B, 0x18A7B4, 0xCC5D3A, 0x866EC5, 0x819F47]),
        "teler-dali": style(
            [0xBE222A, 0x1B8ABD, 0xB07D02, 0x314E94, 0xC67544, 0x8560AC, 0x006129, 0x0887A1],
            [0xDB4241, 0x369DD1, 0xBD891C, 0x4F6EB7, 0xCC7B4B, 0x9D78C6, 0x2C7F44, 0x1299B5]),
        "teler-llobregat": style(
            [0x095D90, 0x993B2B, 0x8A832A, 0x90466C, 0xB27923, 0x00939F, 0x68559B, 0x3B793F],
            [0x3687C2, 0xB45341, 0x9E973F, 0xB16389, 0xC18634, 0x18A7B4, 0x8572BB, 0x59985B]),
        "category10": scheme([
            0x1F77B4, 0xFF7F0E, 0x2CA02C, 0xD62728, 0x9467BD, 0x8C564B, 0xE377C2, 0x7F7F7F, 0xBCBD22, 0x17BECF,
        ]),
        "accent": scheme([0x7FC97F, 0xBEAED4, 0xFDC086, 0xFFFF99, 0x386CB0, 0xF0027F, 0xBF5B17, 0x666666]),
        "dark2": scheme([0x1B9E77, 0xD95F02, 0x7570B3, 0xE7298A, 0x66A61E, 0xE6AB02, 0xA6761D, 0x666666]),
        "observable10": scheme([
            0x4269D0, 0xEFB118, 0xFF725C, 0x6CC5B0, 0x3CA951, 0xFF8AB7, 0xA463F2, 0x97BBF5, 0x9C6B4E, 0x9498A0,
        ]),
        "paired": scheme([
            0xA6CEE3, 0x1F78B4, 0xB2DF8A, 0x33A02C, 0xFB9A99, 0xE31A1C, 0xFDBF6F, 0xFF7F00, 0xCAB2D6, 0x6A3D9A,
            0xFFFF99, 0xB15928,
        ]),
        "pastel1": scheme([
            0xFBB4AE, 0xB3CDE3, 0xCCEBC5, 0xDECBE4, 0xFED9A6, 0xFFFFCC, 0xE5D8BD, 0xFDDAEC, 0xF2F2F2,
        ]),
        "pastel2": scheme([0xB3E2CD, 0xFDCDAC, 0xCBD5E8, 0xF4CAE4, 0xE6F5C9, 0xFFF2AE, 0xF1E2CC, 0xCCCCCC]),
        "set1": scheme([
            0xE41A1C, 0x377EB8, 0x4DAF4A, 0x984EA3, 0xFF7F00, 0xFFFF33, 0xA65628, 0xF781BF, 0x999999,
        ]),
        "set2": scheme([0x66C2A5, 0xFC8D62, 0x8DA0CB, 0xE78AC3, 0xA6D854, 0xFFD92F, 0xE5C494, 0xB3B3B3]),
        "set3": scheme([
            0x8DD3C7, 0xFFFFB3, 0xBEBADA, 0xFB8072, 0x80B1D3, 0xFDB462, 0xB3DE69, 0xFCCDE5, 0xD9D9D9, 0xBC80BD,
            0xCCEBC5, 0xFFED6F,
        ]),
        "tableau10": scheme([
            0x4E79A7, 0xF28E2C, 0xE15759, 0x76B7B2, 0x59A14F, 0xEDC949, 0xAF7AA1, 0xFF9DA7, 0x9C755F, 0xBAB0AB,
        ]),
    ]
}

extension Array {
    fileprivate func wrapped(_ index: Int) -> Element {
        self[((index % count) + count) % count]
    }
}
