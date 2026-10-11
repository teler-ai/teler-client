import Charts
import SwiftUI
import TelerKit

/// A chart, table or metric from an answer, drawn natively from Teler's chart
/// format. The part names it; its spec and data are fetched by slug.
struct ChartCard: View {
    let chart: ChatID
    let reference: ChartReference
    let client: TelerAPIClient
    /// While the answer is still written, the data can arrive a little after the part.
    var isStreaming = false
    var webURL: URL?
    @State private var spec: ChartSpec?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(spec?.title ?? reference.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                if let detail = spec?.description ?? reference.description {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            if let spec {
                ChartBody(spec: spec, webURL: webURL)
            } else if failed {
                Label("This chart didn't load.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Palette.warningInk)
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Palette.fill)
                    .frame(height: 180)
                    .accessibilityLabel("Loading the chart")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        .task(id: reference.slug) { await load() }
    }

    private func load() async {
        // Like the web app, wait up to 30 seconds for data that lags its part.
        for attempt in 0..<(isStreaming ? 15 : 2) {
            do {
                spec = try await client.chartSpec(chat: chart, slug: reference.slug)
                return
            } catch is CancellationError {
                return
            } catch {
                if attempt > 0 || !isStreaming { failed = attempt > 0 }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        failed = true
    }
}

private struct ChartBody: View {
    let spec: ChartSpec
    let webURL: URL?

    var body: some View {
        switch spec.type {
        case "line", "bar", "scatter":
            XYChart(spec: spec)
        case "pie":
            PieChart(slices: spec.slices)
        case "histogram":
            HistogramChart(spec: spec)
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

/// Line, bar and scatter charts: one series per value of the color column.
private struct XYChart: View {
    let spec: ChartSpec

    private var horizontal: Bool { spec.config["encoding"]?["horizontal"]?.boolValue == true }
    private var stacked: Bool { spec.config["encoding"]?["stack"]?.boolValue == true }

    var body: some View {
        let series = spec.series
        Chart {
            ForEach(Array(series.enumerated()), id: \.offset) { _, line in
                ForEach(Array(line.points.enumerated()), id: \.offset) { _, point in
                    mark(point, series: line.name)
                }
            }
        }
        .chartForegroundStyleScale(range: Palette.charts)
        .chartLegend(series.count > 1 ? .visible : .hidden)
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
        .frame(height: horizontal ? CGFloat(max(series.first?.points.count ?? 0, 3)) * 34 : 200)
        .accessibilityLabel(spec.title ?? String(localized: "Chart"))
    }

    @ChartContentBuilder private func mark(_ point: ChartPoint, series: String?) -> some ChartContent {
        let name = series ?? ""
        switch (spec.type, point.x) {
        case ("line", .date(let date)):
            LineMark(x: .value("x", date), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
                .interpolationMethod(.monotone)
        case ("line", .number(let number)):
            LineMark(x: .value("x", number), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case ("line", .text(let text)):
            LineMark(x: .value("x", text), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case ("scatter", .number(let number)):
            PointMark(x: .value("x", number), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case ("scatter", .date(let date)):
            PointMark(x: .value("x", date), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case ("scatter", .text(let text)):
            PointMark(x: .value("x", text), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case (_, .date(let date)):
            BarMark(x: .value("x", date, unit: .month), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
                .position(by: .value("Series", stacked ? "" : name))
        case (_, .number(let number)):
            BarMark(x: .value("x", number), y: .value("y", point.y))
                .foregroundStyle(by: .value("Series", name))
        case (_, .text(let text)):
            if horizontal {
                BarMark(x: .value("y", point.y), y: .value("x", text))
                    .foregroundStyle(by: .value("Series", name))
                    .annotation(position: .trailing) {
                        Text(point.y, format: .number.notation(.compactName))
                            .font(.caption2)
                            .foregroundStyle(Palette.mutedForeground)
                    }
            } else {
                BarMark(x: .value("x", text), y: .value("y", point.y))
                    .foregroundStyle(by: .value("Series", name))
                    .position(by: .value("Series", stacked ? "" : name))
            }
        }
    }
}

private struct PieChart: View {
    let slices: [(name: String, value: Double)]

    var body: some View {
        Chart {
            ForEach(Array(slices.enumerated()), id: \.offset) { _, slice in
                SectorMark(angle: .value("Value", slice.value), innerRadius: .ratio(0.55), angularInset: 1)
                    .foregroundStyle(by: .value("Name", slice.name))
            }
        }
        .chartForegroundStyleScale(range: Palette.charts)
        .frame(height: 220)
    }
}

private struct HistogramChart: View {
    let spec: ChartSpec

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
        .frame(height: 200)
    }
}

/// A table artifact: its columns as a scrolling grid.
private struct DataTable: View {
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
private struct MetricTiles: View {
    let spec: ChartSpec

    var body: some View {
        let metrics: [JSONValue] = spec.type == "metric" ? [spec.data] : spec.data["metrics"]?.arrayValue ?? []
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
            ForEach(Array(metrics.enumerated()), id: \.offset) { _, metric in
                VStack(alignment: .leading, spacing: 4) {
                    if let title = metric["title"]?.stringValue {
                        Text(title).font(.footnote).foregroundStyle(Palette.mutedForeground)
                    }
                    Text(metric["value"]?.display ?? "")
                        .font(.title2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.foreground)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let delta = metric["delta"]?.display, !delta.isEmpty {
                        Label(delta, systemImage: trendSymbol(metric["trend"]?.stringValue))
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.fill, in: .rect(cornerRadius: 14))
            }
        }
    }

    private func trendSymbol(_ trend: String?) -> String {
        switch trend {
        case "up": "arrow.up"
        case "down": "arrow.down"
        default: "minus"
        }
    }
}
