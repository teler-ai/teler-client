import Charts
import SwiftUI
import TelerKit

/// A chart, table or metric drawn natively from Teler's chart format.
struct ChartBody: View {
    let spec: ChartSpec
    let webURL: URL?
    var height: CGFloat = 200

    var body: some View {
        if let limitation = spec.limitation {
            ChartLimitationNotice(limitation: limitation)
        } else {
            switch spec.type {
            case "line", "bar", "scatter":
                XYChart(spec: spec, height: height)
            case "pie":
                PieChart(spec: spec, height: height + 20)
            case "histogram":
                HistogramChart(spec: spec, height: height)
            case "table":
                DataTable(spec: spec)
            case "metric", "metric_grid":
                MetricTiles(spec: spec)
            default:
                HStack(spacing: 8) {
                    Image(systemName: "rectangle.on.rectangle")
                    Text("This chart shows on the web for now.")
                    Spacer(minLength: 0)
                    if let webURL { Link("Open", destination: webURL).fontWeight(.semibold) }
                }
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    /// Whether the chart opens in the larger view with its data.
    static func opensDetail(_ spec: ChartSpec) -> Bool {
        ["line", "bar", "scatter", "pie", "histogram", "table"].contains(spec.type) && spec.csv(.raw) != nil
    }
}

/// Why an older chart isn't drawn, in the web's words.
struct ChartLimitationNotice: View {
    let limitation: ChartLimitation

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var message: String {
        switch limitation {
        case .tooManyMarks:
            String(
                localized:
                    "This chart has too many category and series combinations to display. Export the original CSV or explicitly aggregate or limit the data."
            )
        case .ambiguousCategories:
            String(
                localized:
                    "This chart has multiple values for the same series and category. Export the original CSV or choose an aggregation before charting."
            )
        case .facets, .annotations, .colors:
            String(localized: "This chart uses an unsupported configuration. Recreate it with supported chart options.")
        }
    }
}

struct PieChart: View {
    let spec: ChartSpec
    var height: CGFloat = 220

    var body: some View {
        let slices = spec.slices
        let coloring = spec.appearance.coloring(for: slices.map(\.key))
        if slices.isEmpty {
            Text("No chart data available")
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        } else {
            Chart {
                ForEach(Array(slices.enumerated()), id: \.offset) { _, slice in
                    SectorMark(angle: .value("Value", slice.value), innerRadius: .ratio(0.55), angularInset: 1)
                        .foregroundStyle(by: .value("Name", slice.name))
                }
            }
            .chartForegroundStyleScale(
                domain: coloring.legendOrder.map(ChartCategory.label),
                range: coloring.legendOrder.map { ChartPalettes.color(coloring.color($0)) }
            )
            .frame(height: height)
        }
    }
}

struct HistogramChart: View {
    let spec: ChartSpec
    var height: CGFloat = 200

    var body: some View {
        let bins = (spec.data["bins"]?.arrayValue ?? []).compactMap { bin -> (Double, Double, Double)? in
            guard let start = bin["start"]?.doubleValue, let end = bin["end"]?.doubleValue,
                let count = bin["count"]?.doubleValue
            else { return nil }
            return (start, end, count)
        }
        Chart {
            ForEach(Array(bins.enumerated()), id: \.offset) { _, bin in
                RectangleMark(
                    xStart: .value("From", bin.0), xEnd: .value("To", bin.1), yStart: .value("Zero", 0),
                    yEnd: .value("Count", bin.2)
                )
                .foregroundStyle(Palette.charts[0])
            }
        }
        .frame(height: height)
    }
}

/// A table artifact: its columns as a scrolling grid.
struct DataTable: View {
    let spec: ChartSpec

    var body: some View {
        let columns = spec.columns
        let rows = columns.map(\.values.count).max() ?? 0
        TableBlock(
            table: MarkdownTable(
                header: columns.map(\.name),
                alignments: columns.map { $0.kind == .number ? .trailing : .leading },
                rows: (0..<min(rows, 200)).map { row in
                    columns.map { column in
                        guard column.values.indices.contains(row) else { return "" }
                        let value = column.values[row]
                        if column.kind == .number, let number = value.doubleValue {
                            return number.formatted(.number.precision(.fractionLength(0...2)))
                        }
                        return value.display
                    }
                }))
    }
}

/// Metric cards: a value, its change and its trend.
struct MetricTiles: View {
    let spec: ChartSpec

    var body: some View {
        let metrics: [JSONValue] = spec.type == "metric" ? [spec.data] : spec.data["metrics"]?.arrayValue ?? []
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
            ForEach(Array(metrics.enumerated()), id: \.offset) { _, metric in
                KPITile(
                    title: metric["title"]?.stringValue ?? spec.title ?? "",
                    value: metric["value"]?.display ?? "", delta: metric["delta"]?.display,
                    trend: Trend(metric["trend"]?.stringValue))
            }
        }
    }
}
