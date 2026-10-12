import SwiftUI
import TelerKit
import UniformTypeIdentifiers

/// A chart opened large: drag across it to read every series at one point,
/// tap a series to focus it, or switch to its exact values. Share sends the
/// chart as an image, or the data as CSV from the table.
struct ChartDetailView: View {
    let spec: ChartSpec
    let title: String
    @State private var mode: Mode
    @State private var picked: Int?
    @State private var focused: String?
    @State private var image: Image?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    private enum Mode: Hashable {
        case chart, table
    }

    /// `initialState` opens it a certain way for screenshots: `pick:<index>`, `focus:<series>` or `table`.
    init(spec: ChartSpec, title: String, initialState: String? = nil) {
        self.spec = spec
        self.title = spec.title ?? title
        _mode = State(initialValue: Self.draws(spec) && initialState != "table" ? .chart : .table)
        if let state = initialState, state.hasPrefix("focus:") { _focused = State(initialValue: String(state.dropFirst(6))) }
        if let state = initialState, state.hasPrefix("pick:") { _picked = State(initialValue: Int(state.dropFirst(5))) }
    }

    private static func draws(_ spec: ChartSpec) -> Bool {
        spec.limitation == nil && ["line", "bar", "scatter", "pie", "histogram"].contains(spec.type)
    }

    private var grid: ChartGrid? { ChartGrid(spec: spec) }

    /// The point read before anyone picks one: the latest date or number, or the first category.
    private func readIndex(_ grid: ChartGrid) -> Int {
        if let picked { return picked }
        if case .text? = grid.xs.first { return 0 }
        return grid.xs.count - 1
    }
    private var granularity: DateGranularity { DateGranularity.of(grid?.xs.compactMap(\.date) ?? []) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if Self.draws(spec) {
                    Picker("View", selection: $mode) {
                        Text("Chart").tag(Mode.chart)
                        Text("Table").tag(Mode.table)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
                switch mode {
                case .chart: chartPage
                case .table: tablePage
                }
            }
            .background(Palette.background)
            .navigationTitle(title)
            .navigationSubtitle(subtitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) { share }
            }
        }
        .task(id: colorScheme) { render() }
    }

    // MARK: Chart

    private var chartPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let grid {
                    header(grid)
                    XYChart(
                        spec: spec, height: 280, focused: focused, selected: picked.map { grid.xs[$0] },
                        onSelect: { value in picked = grid.nearest(to: value) ?? picked }, showsLegend: false)
                    if grid.series.count > 1 { legend(grid) }
                    Label(
                        grid.series.count > 1
                            ? "Drag across the chart to read every series at one point. Tap a series to focus it."
                            : "Drag across the chart to read a value.",
                        systemImage: "info.circle"
                    )
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                } else {
                    ChartBody(spec: spec, webURL: nil, height: 300)
                }
            }
            .padding()
        }
        .sensoryFeedback(.selection, trigger: picked)
    }

    private func header(_ grid: ChartGrid) -> some View {
        let index = readIndex(grid)
        let position = ChartFormat.label(grid.xs[index], granularity)
        let ordered: Bool = if case .text = grid.xs[index] { false } else { true }
        let single = grid.series.count == 1 ? 0 : grid.series.firstIndex { $0.key == focused }
        return VStack(alignment: .leading, spacing: 2) {
            if let single {
                let name = grid.series[single].name
                Text(name.map { "\($0) · \(position)" } ?? position)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(grid.value(series: single, at: index).map(ChartFormat.compact) ?? "–")
                        .font(.title2.weight(.bold))
                    if ordered, let change = grid.change(series: single, at: index) {
                        Text(ChartFormat.change(change))
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            } else if spec.type == "bar", spec.config["encoding"]?["stack"]?.boolValue == true {
                Text(position).font(.footnote).foregroundStyle(Palette.mutedForeground)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(grid.total(at: index).map(ChartFormat.compact) ?? "–").font(.title2.weight(.bold))
                    Text("total").font(.subheadline).foregroundStyle(Palette.mutedForeground)
                }
            } else {
                if let label = spec.yLabel {
                    Text(label).font(.footnote).foregroundStyle(Palette.mutedForeground)
                }
                Text(position).font(.title2.weight(.bold))
            }
        }
        .foregroundStyle(Palette.foreground)
        .accessibilityElement(children: .combine)
    }

    /// One chip per series with its value at the point being read; tapping focuses it.
    private func legend(_ grid: ChartGrid) -> some View {
        let style = SeriesStyle(spec: spec, series: grid.series)
        let index = readIndex(grid)
        let ordered = grid.series.indices.sorted {
            (style.domain.firstIndex(of: grid.series[$0].name ?? "") ?? 0)
                < (style.domain.firstIndex(of: grid.series[$1].name ?? "") ?? 0)
        }
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            ForEach(ordered, id: \.self) { series in
                let line = grid.series[series]
                let isFocused = focused == line.key
                Button {
                    withAnimation(.snappy) { focused = isFocused ? nil : line.key }
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(style.color(line.name ?? line.key)).frame(width: 8, height: 8)
                        Text(line.name ?? line.key).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(grid.value(series: series, at: index).map(ChartFormat.compact) ?? "–")
                            .fontWeight(.semibold)
                            .monospacedDigit()
                    }
                    .font(.subheadline)
                    .foregroundStyle(isFocused ? Palette.background : Palette.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(isFocused ? Palette.foreground : Palette.fill, in: .capsule)
                    .opacity(focused == nil || isFocused ? 1 : 0.55)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isFocused ? .isSelected : [])
            }
            if focused != nil {
                Button("Show all") { withAnimation(.snappy) { focused = nil } }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Palette.fill, in: .capsule)
                    .buttonStyle(.plain)
            }
        }
    }

    // MARK: Table

    private var tablePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let limitation = spec.limitation {
                    ChartLimitationNotice(limitation: limitation)
                }
                ChartValuesTable(table: table)
                Label("Touch and hold a value to copy it.", systemImage: "doc.on.doc")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .padding()
        }
    }

    /// The exact values: by position and series when the chart has them, otherwise its columns.
    private var table: ChartValuesTable.Content {
        if let grid {
            let header = [spec.xLabel ?? spec.encoded("x")?.name ?? ""]
                + grid.series.map { $0.name ?? spec.yLabel ?? $0.key }
            let rows = grid.xs.indices.prefix(500).map { index in
                [ChartFormat.label(grid.xs[index], granularity)]
                    + grid.series.indices.map { grid.value(series: $0, at: index).map(ChartFormat.exact) ?? "" }
            }
            return .init(header: header, rows: rows, numeric: [false] + grid.series.map { _ in true })
        }
        if spec.type == "histogram" {
            let bins = spec.data["bins"]?.arrayValue ?? []
            let rows = bins.prefix(500).map { bin in
                ["start", "end", "count"].map { bin[$0]?.doubleValue.map(ChartFormat.exact) ?? "" }
            }
            return .init(header: ["From", "To", "Count"], rows: rows, numeric: [true, true, true])
        }
        let columns = spec.columns
        let count = columns.map(\.values.count).max() ?? 0
        let rows = (0..<min(count, 500)).map { row in
            columns.map { column -> String in
                guard column.values.indices.contains(row) else { return "" }
                let value = column.values[row]
                return column.kind == .number ? value.doubleValue.map(ChartFormat.exact) ?? "" : value.display
            }
        }
        return .init(header: columns.map(\.name), rows: rows, numeric: columns.map { $0.kind == .number })
    }

    // MARK: Sharing

    private var subtitle: String {
        if let description = spec.description { return description }
        var parts: [String] = []
        if let grid, let first = grid.xs.first, let last = grid.xs.last, first != last {
            parts.append("\(ChartFormat.label(first, granularity, short: true))–\(ChartFormat.label(last, granularity, short: true))")
        }
        if let label = spec.yLabel { parts.append(label) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var share: some View {
        if mode == .table, let csv = spec.csv(.spreadsheet) {
            ShareLink(item: ChartCSV(name: title, text: csv), preview: SharePreview("\(title).csv")) {
                Label("Share the data", systemImage: "square.and.arrow.up")
            }
        } else if let image {
            ShareLink(item: image, preview: SharePreview(title, image: image)) {
                Label("Share the chart", systemImage: "square.and.arrow.up")
            }
        }
    }

    /// The chart as an image, with its title, in the current appearance.
    private func render() {
        guard Self.draws(spec) else { return }
        let content = VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline).foregroundStyle(Palette.foreground)
            if !subtitle.isEmpty {
                Text(subtitle).font(.footnote).foregroundStyle(Palette.mutedForeground)
            }
            ChartBody(spec: spec, webURL: nil, height: 260).padding(.top, 8)
        }
        .padding(20)
        .frame(width: 420)
        .background(Palette.card)
        .environment(\.colorScheme, colorScheme)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 3
        image = renderer.uiImage.map { Image(uiImage: $0) }
    }
}

/// A chart's data as a CSV file to share.
struct ChartCSV: Transferable {
    let name: String
    let text: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .commaSeparatedText) { Data($0.text.utf8) }
            .suggestedFileName { "\($0.name.replacingOccurrences(of: "/", with: "-")).csv" }
    }
}

/// How chart values read: dates in UTC at the chart's granularity, compact
/// numbers for reading at a glance and exact ones in tables.
enum ChartFormat {
    static func label(_ value: ChartValue, _ granularity: DateGranularity, short: Bool = false) -> String {
        switch value {
        case .date(let date):
            var style: Date.FormatStyle =
                switch granularity {
                case .year: .dateTime.year()
                case .month: short ? .dateTime.month(.abbreviated).year() : .dateTime.month(.wide).year()
                case .day: .dateTime.day().month(short ? .abbreviated : .wide).year()
                case .time: .dateTime.day().month(.abbreviated).hour().minute()
                }
            style.timeZone = .gmt
            return date.formatted(style)
        case .number(let number):
            return exact(number)
        case .text(let text):
            return text
        }
    }

    static func compact(_ number: Double) -> String {
        number.formatted(.number.notation(.compactName).precision(.significantDigits(1...3)))
    }

    static func exact(_ number: Double) -> String {
        number.formatted(.number.precision(.fractionLength(0...2)))
    }

    /// "↑ 6.3%" against the previous value.
    static func change(_ fraction: Double) -> String {
        let arrow = fraction > 0 ? "↑" : fraction < 0 ? "↓" : "→"
        return "\(arrow) \(abs(fraction).formatted(.percent.precision(.fractionLength(1))))"
    }
}
