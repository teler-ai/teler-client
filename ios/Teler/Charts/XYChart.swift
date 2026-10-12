import Charts
import SwiftUI
import TelerKit

/// Line, bar and scatter charts, with each series in the color the web gives it.
struct XYChart: View {
    let spec: ChartSpec
    var height: CGFloat = 200
    /// The series to keep in color; the others turn neutral.
    var focused: String?
    /// The position being read, marked with a rule and a point per series.
    var selected: ChartValue?
    /// Called while someone drags across the chart; nil when the chart can't be read that way.
    var onSelect: ((ChartValue) -> Void)?
    /// Off where the series are listed next to the chart instead.
    var showsLegend = true
    @State private var dateSelection: Date?
    @State private var numberSelection: Double?
    @State private var textSelection: String?

    private var horizontal: Bool { spec.config["encoding"]?["horizontal"]?.boolValue == true }
    private var stacked: Bool { spec.config["encoding"]?["stack"]?.boolValue == true }

    var body: some View {
        let series = spec.series
        let style = SeriesStyle(spec: spec, series: series, focused: focused)
        let granularity = DateGranularity.of(series.flatMap(\.points).compactMap(\.x.date))
        selectable(
            Chart {
                if spec.type == "line", let line = series.first(where: { $0.key == focused }) {
                    ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
                        area(point, color: style.color(style.label(line, point)))
                    }
                }
                ForEach(series, id: \.key) { line in
                    ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
                        mark(point, label: style.label(line, point), unit: granularity.unit)
                    }
                }
                if let selected, !horizontal {
                    rule(at: selected, unit: granularity.unit)
                    ForEach(series, id: \.key) { line in
                        if let point = line.points.first(where: { $0.x == selected }), spec.type == "line" {
                            highlight(point, label: style.label(line, point))
                        }
                    }
                }
            }
            .chartForegroundStyleScale(domain: style.domain, range: style.range)
            .chartLegend(style.showsLegend && showsLegend ? .visible : .hidden)
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(number, format: .number.notation(.compactName))
                        }
                    }
                }
            }
            .environment(\.timeZone, .gmt)
            .frame(height: horizontal ? CGFloat(max(series.first?.points.count ?? 0, 3)) * 34 : height)
            .accessibilityLabel(spec.title ?? String(localized: "Chart")))
    }

    @ChartContentBuilder private func mark(_ point: ChartPoint, label: String, unit: Calendar.Component)
        -> some ChartContent
    {
        let dimmed = selected != nil && spec.type == "bar" && point.x != selected
        switch (spec.type, point.x) {
        case ("line", .date(let date)):
            LineMark(x: .value("x", date), y: .value("y", point.y), series: .value("Series", label))
                .foregroundStyle(by: .value("Series", label))
                .interpolationMethod(.monotone)
        case ("line", .number(let number)):
            LineMark(x: .value("x", number), y: .value("y", point.y), series: .value("Series", label))
                .foregroundStyle(by: .value("Series", label))
        case ("line", .text(let text)):
            LineMark(x: .value("x", text), y: .value("y", point.y), series: .value("Series", label))
                .foregroundStyle(by: .value("Series", label))
        case ("scatter", .number(let number)):
            PointMark(x: .value("x", number), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", label))
        case ("scatter", .date(let date)):
            PointMark(x: .value("x", date), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", label))
        case ("scatter", .text(let text)):
            PointMark(x: .value("x", text), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", label))
        case (_, .date(let date)):
            BarMark(x: .value("x", date, unit: unit), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", label))
                .position(by: .value("Series", stacked ? "" : label))
                .opacity(dimmed ? 0.4 : 1)
        case (_, .number(let number)):
            BarMark(x: .value("x", number), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", label))
                .opacity(dimmed ? 0.4 : 1)
        case (_, .text(let text)):
            if horizontal {
                BarMark(x: .value("y", point.y), y: .value("x", text))
                    .foregroundStyle(by: .value("Series", label))
                    .opacity(dimmed ? 0.4 : 1)
                    .annotation(position: .trailing) {
                        Text(point.y, format: .number.notation(.compactName))
                            .font(.caption2)
                            .foregroundStyle(Palette.mutedForeground)
                    }
            } else {
                BarMark(x: .value("x", text), y: .value("y", point.y))
                    .foregroundStyle(by: .value("Series", label))
                    .position(by: .value("Series", stacked ? "" : label))
                    .opacity(dimmed ? 0.4 : 1)
            }
        }
    }

    /// The focused line's area, so it stands out from the neutral ones.
    @ChartContentBuilder private func area(_ point: ChartPoint, color: Color) -> some ChartContent {
        switch point.x {
        case .date(let date):
            AreaMark(x: .value("x", date), y: .value("y", point.y))
                .foregroundStyle(color.opacity(0.14))
                .interpolationMethod(.monotone)
        case .number(let number):
            AreaMark(x: .value("x", number), y: .value("y", point.y)).foregroundStyle(color.opacity(0.14))
        case .text(let text):
            AreaMark(x: .value("x", text), y: .value("y", point.y)).foregroundStyle(color.opacity(0.14))
        }
    }

    @ChartContentBuilder private func rule(at value: ChartValue, unit: Calendar.Component) -> some ChartContent {
        switch value {
        case .date(let date):
            if spec.type == "bar" {
                RuleMark(x: .value("x", date, unit: unit)).foregroundStyle(Palette.mutedForeground.opacity(0.5))
            } else {
                RuleMark(x: .value("x", date)).foregroundStyle(Palette.mutedForeground.opacity(0.5))
            }
        case .number(let number):
            RuleMark(x: .value("x", number)).foregroundStyle(Palette.mutedForeground.opacity(0.5))
        case .text(let text):
            RuleMark(x: .value("x", text)).foregroundStyle(Palette.mutedForeground.opacity(0.5))
        }
    }

    @ChartContentBuilder private func highlight(_ point: ChartPoint, label: String) -> some ChartContent {
        switch point.x {
        case .date(let date):
            PointMark(x: .value("x", date), y: .value("y", point.y)).foregroundStyle(by: .value("Series", label))
                .symbolSize(60)
        case .number(let number):
            PointMark(x: .value("x", number), y: .value("y", point.y)).foregroundStyle(by: .value("Series", label))
                .symbolSize(60)
        case .text(let text):
            PointMark(x: .value("x", text), y: .value("y", point.y)).foregroundStyle(by: .value("Series", label))
                .symbolSize(60)
        }
    }

    /// Reading the chart by dragging: x for columns and lines, y for horizontal bars.
    @ViewBuilder private func selectable(_ chart: some View) -> some View {
        if onSelect == nil {
            chart
        } else if horizontal {
            chart.chartYSelection(value: $textSelection)
                .onChange(of: textSelection) { _, text in if let text { onSelect?(.text(text)) } }
        } else {
            switch spec.series.first?.points.first?.x {
            case .date?:
                chart.chartXSelection(value: $dateSelection)
                    .onChange(of: dateSelection) { _, date in if let date { onSelect?(.date(date)) } }
            case .number?:
                chart.chartXSelection(value: $numberSelection)
                    .onChange(of: numberSelection) { _, number in if let number { onSelect?(.number(number)) } }
            default:
                chart.chartXSelection(value: $textSelection)
                    .onChange(of: textSelection) { _, text in if let text { onSelect?(.text(text)) } }
            }
        }
    }
}

/// Each plotted series' name and color: by series, by mark for bars that each
/// have their own category, or one color for a single series.
struct SeriesStyle {
    let domain: [String]
    let range: [Color]
    let showsLegend: Bool
    private let byMark: Bool

    init(spec: ChartSpec, series: [ChartSeries], focused: String? = nil) {
        let marks = series.flatMap(\.points).compactMap(\.colorKey)
        let byMark = !marks.isEmpty
        self.byMark = byMark
        let grouped = series.contains { $0.name != nil }
        let keys = byMark ? marks : series.map(\.key)
        // Bars take slots in drawing order and lines in sorted order, as on the web.
        let coloring = spec.appearance.coloring(for: keys, drawn: byMark || spec.type == "bar")
        domain = coloring.legendOrder.map { byMark || grouped ? ChartCategory.label($0) : $0 }
        range = coloring.legendOrder.map { key in
            guard let focused else { return ChartPalettes.color(coloring.color(key)) }
            guard key == focused else { return Palette.chartsRest[0] }
            // A neutral series standing alone takes the style's last color, as on the web.
            if case .neutral = coloring.color(key) { return Palette.charts[Palette.charts.count - 1] }
            return ChartPalettes.color(coloring.color(key))
        }
        showsLegend = !byMark && grouped && series.count > 1
    }

    func label(_ series: ChartSeries, _ point: ChartPoint) -> String {
        if byMark, let key = point.colorKey { return ChartCategory.label(key) }
        return series.name ?? series.key
    }

    func color(_ label: String) -> Color {
        domain.firstIndex(of: label).map { range[$0] } ?? Palette.charts[0]
    }
}

extension ChartValue {
    var date: Date? {
        if case .date(let date) = self { return date }
        return nil
    }
}

extension DateGranularity {
    var unit: Calendar.Component {
        switch self {
        case .year: .year
        case .month: .month
        case .day: .day
        case .time: .hour
        }
    }
}
