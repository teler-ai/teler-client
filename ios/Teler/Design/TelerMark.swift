import SwiftUI

/// Teler's mark, the loom, in the brand gradient. Its outline is the one in the
/// web app's favicon (`apps/chat/web/public/favicon.svg` in the Teler repository).
struct TelerMark: View {
    /// The gradient's colors are the brand's own and don't change with the appearance.
    private static let gradient = LinearGradient(
        stops: [
            .init(color: Color(red: 0xB7 / 255, green: 0x90 / 255, blue: 0x4B / 255), location: 0),
            .init(color: Color(red: 0xD4 / 255, green: 0xA8 / 255, blue: 0x53 / 255), location: 0.55),
            .init(color: Color(red: 0x7C / 255, green: 0x9A / 255, blue: 0x82 / 255), location: 1),
        ],
        startPoint: .topLeading, endPoint: .bottomTrailing)

    var body: some View {
        MarkShape()
            .fill(Self.gradient, style: FillStyle(eoFill: true))
            .aspectRatio(MarkShape.size.width / MarkShape.size.height, contentMode: .fit)
            .accessibilityHidden(true)
    }
}

/// The mark's outline, scaled to fit its frame.
struct MarkShape: Shape {
    static let size = CGSize(width: 347, height: 307)

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / Self.size.width, rect.height / Self.size.height)
        let x = rect.minX + (rect.width - Self.size.width * scale) / 2
        let y = rect.minY + (rect.height - Self.size.height * scale) / 2
        return Self.outline.applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: x, ty: y))
    }

    /// The SVG path, which uses only absolute moves, lines and cubic curves.
    private static let outline: Path = {
        var path = Path()
        var command: Character = "M"
        var values: [CGFloat] = []
        let tokens = data.map { $0.isLetter ? " \($0) " : String($0) }.joined()
            .split(whereSeparator: \.isWhitespace)
        for token in tokens {
            if let letter = token.first, letter.isLetter {
                command = letter
                continue
            }
            guard let value = Double(token) else { continue }
            values.append(CGFloat(value))
            switch command {
            case "M" where values.count == 2:
                path.move(to: CGPoint(x: values[0], y: values[1]))
                command = "L"
            case "L" where values.count == 2:
                path.addLine(to: CGPoint(x: values[0], y: values[1]))
            case "C" where values.count == 6:
                path.addCurve(
                    to: CGPoint(x: values[4], y: values[5]), control1: CGPoint(x: values[0], y: values[1]),
                    control2: CGPoint(x: values[2], y: values[3]))
            default:
                continue
            }
            values.removeAll()
        }
        return path
    }()

    private static let data = """
        M89.000 28.028 C 118.303 30.066 141.884 36.399 160.747 47.298 C 176.078 56.156 175.430
        54.356 166.448 63.136 L 158.688 70.722 151.883 66.865 C 148.139 64.744 142.593 61.910
        139.556 60.567 C 132.560 57.473 114.623 52.474 105.500 51.075 C 99.034 50.084 73.103 48.033
        66.750 48.010 L 64.000 48.000 64.000 63.500 L 64.000 79.000 73.750 79.003 C 94.761 79.009
        115.181 83.211 130.753 90.732 C 135.843 93.190 140.275 95.636 140.603 96.167 C 141.152
        97.055 134.598 113.350 132.871 115.392 C 132.455 115.884 129.961 114.904 127.308 113.205 C
        112.954 104.017 97.532 100.826 65.500 100.421 L 42.500 100.129 42.238 63.565 L 41.975 27.000
        58.238 27.010 C 67.182 27.015 81.025 27.474 89.000 28.028 M315.762 63.725 L 315.500 100.449
        303.500 100.682 C 259.021 101.544 234.063 118.513 204.490 168.000 C 188.285 195.116 185.091
        200.089 176.868 211.000 C 156.140 238.505 134.797 256.945 108.924 269.702 C 89.188 279.432
        71.245 284.523 52.710 285.653 L 41.919 286.310 42.380 278.905 C 42.634 274.832 42.877
        270.090 42.921 268.367 L 43.000 265.235 50.750 264.545 C 95.572 260.554 134.571 235.505
        165.250 191.000 C 168.851 185.775 176.632 173.400 182.539 163.500 C 195.978 140.980 199.422
        135.826 208.885 124.077 C 229.976 97.891 259.325 82.021 290.873 79.743 L 294.245 79.500
        294.254 64.000 C 294.263 48.572 294.252 48.498 291.954 48.157 C 289.015 47.721 261.717
        49.766 252.500 51.113 C 237.881 53.250 217.962 59.905 206.545 66.468 C 198.590 71.041
        186.641 80.989 180.549 88.114 C 159.047 113.255 148.735 145.545 149.051 186.743 C 149.121
        195.807 148.789 203.611 148.315 204.085 C 147.832 204.568 142.957 200.156 137.233 194.057 L
        127.014 183.166 127.551 174.333 C 130.283 129.422 144.392 93.983 169.748 68.348 C 190.559
        47.308 215.387 35.419 250.000 29.918 C 261.136 28.148 275.215 27.314 296.762 27.148 L
        316.025 27.000 315.762 63.725 M202.915 85.874 C 205.109 89.105 208.773 95.406 211.058 99.876
        L 215.212 108.004 209.545 114.124 C 206.429 117.491 202.936 121.520 201.785 123.078 L
        199.690 125.910 196.458 118.476 C 194.681 114.387 190.925 107.417 188.113 102.988 C 185.301
        98.558 183.000 94.622 183.000 94.242 C 183.000 93.004 196.410 80.000 197.686 80.000 C
        198.368 80.000 200.721 82.643 202.915 85.874 M228.590 157.614 C 231.493 180.172 230.622
        208.956 226.456 228.178 C 221.207 252.397 208.509 272.201 193.530 279.529 C 177.449 287.397
        159.436 281.304 146.598 263.656 L 141.620 256.812 149.560 249.452 C 153.927 245.405 157.828
        242.072 158.230 242.046 C 158.631 242.021 159.916 243.876 161.086 246.168 C 164.126 252.128
        172.299 259.778 176.460 260.558 C 185.953 262.339 194.895 253.470 201.723 235.500 C 206.202
        223.712 208.167 211.064 208.876 189.463 L 209.500 170.426 217.928 157.724 C 222.563 150.738
        226.514 145.181 226.708 145.375 C 226.902 145.568 227.749 151.076 228.590 157.614 M120.172
        185.008 C 132.453 197.662 142.628 208.598 142.785 209.310 C 142.942 210.021 139.840 213.722
        135.892 217.534 L 128.715 224.463 112.869 207.982 L 97.023 191.500 72.605 216.500 C 59.175
        230.250 47.975 241.275 47.716 241.000 C 45.338 238.472 42.626 230.464 42.216 224.758 L
        41.732 218.016 50.586 208.758 C 67.071 191.520 96.476 162.000 97.162 162.000 C 97.538
        162.000 107.892 172.353 120.172 185.008
        """
}
