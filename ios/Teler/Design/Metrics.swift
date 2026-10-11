import Charts
import SwiftUI

/// Which way a number moved.
enum Trend {
    case up
    case down
    case flat

    init(_ word: String?) {
        switch word {
        case "up": self = .up
        case "down": self = .down
        default: self = .flat
        }
    }

    var symbol: String {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "minus"
        }
    }
}

/// A headline number: what it measures, its value and how it changed.
struct KPITile: View {
    let title: String
    let value: String
    var delta: String?
    var trend = Trend.flat

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .lineLimit(2)
            Text(value)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let delta, !delta.isEmpty {
                Label(delta, systemImage: trend.symbol)
                    .labelStyle(CompactLabelStyle())
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border))
        .accessibilityElement(children: .combine)
    }
}

/// A small line of recent values, without axes.
struct Sparkline: View {
    let values: [Double]

    var body: some View {
        Chart {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                LineMark(x: .value("Point", index), y: .value("Value", value))
                    .interpolationMethod(.monotone)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: .automatic(includesZero: false))
        .foregroundStyle(Palette.charts[0])
        .accessibilityHidden(true)
    }
}

/// An icon tight against its title, as in "↑ 6.4%".
struct CompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}
