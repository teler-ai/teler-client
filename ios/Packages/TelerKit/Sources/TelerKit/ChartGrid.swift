import Foundation

/// A line or bar chart's values by position on x and by series: what reading
/// the chart at one point and its table of exact values show.
public struct ChartGrid: Sendable, Hashable {
    /// Positions on x: dates and numbers ascending, categories in the order
    /// they first appear.
    public let xs: [ChartValue]
    public let series: [ChartSeries]
    /// `values[series][x]`, nil where a series has no value.
    public let values: [[Double?]]

    /// Nil for other chart types, or when a series has two values at the same x.
    public init?(spec: ChartSpec) {
        guard spec.type == "line" || spec.type == "bar" else { return nil }
        let series = spec.series
        guard !series.isEmpty else { return nil }
        var xs: [ChartValue] = []
        var seen = Set<ChartValue>()
        for point in series.flatMap(\.points) where seen.insert(point.x).inserted {
            xs.append(point.x)
        }
        if xs.allSatisfy({ if case .date = $0 { true } else { false } })
            || xs.allSatisfy({ if case .number = $0 { true } else { false } })
        {
            xs.sort { $0.sortValue < $1.sortValue }
        }
        let positions = Dictionary(uniqueKeysWithValues: xs.enumerated().map { ($1, $0) })
        var values: [[Double?]] = []
        for line in series {
            var row = [Double?](repeating: nil, count: xs.count)
            for point in line.points {
                guard let position = positions[point.x], row[position] == nil else { return nil }
                row[position] = point.y
            }
            values.append(row)
        }
        self.xs = xs
        self.series = series
        self.values = values
    }

    public func value(series: Int, at x: Int) -> Double? {
        values.indices.contains(series) && values[series].indices.contains(x) ? values[series][x] : nil
    }

    /// The sum across series at one position, or nil when none has a value.
    public func total(at x: Int) -> Double? {
        let present = values.indices.compactMap { value(series: $0, at: x) }
        return present.isEmpty ? nil : present.reduce(0, +)
    }

    /// The change from the previous position with a value, as a fraction.
    public func change(series: Int, at x: Int) -> Double? {
        guard let current = value(series: series, at: x), x > 0,
            let previous = (0..<x).reversed().lazy.compactMap({ self.value(series: series, at: $0) }).first,
            previous != 0
        else { return nil }
        return (current - previous) / abs(previous)
    }

    /// The position nearest to a point read from the chart.
    public func nearest(to value: ChartValue) -> Int? {
        if let exact = xs.firstIndex(of: value) { return exact }
        guard case .text = value else {
            return xs.indices.min { abs(xs[$0].sortValue - value.sortValue) < abs(xs[$1].sortValue - value.sortValue) }
        }
        return nil
    }
}

extension ChartValue {
    var sortValue: Double {
        switch self {
        case .number(let number): number
        case .date(let date): date.timeIntervalSince1970
        case .text: 0
        }
    }
}

/// How finely a chart's dates are spaced, read in UTC because dates without
/// a time arrive as midnight UTC.
public enum DateGranularity: Sendable, Hashable {
    case year
    case month
    case day
    case time

    public static func of(_ dates: [Date]) -> DateGranularity {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let parts = dates.map { calendar.dateComponents([.month, .day, .hour, .minute, .second], from: $0) }
        guard parts.allSatisfy({ $0.hour == 0 && $0.minute == 0 && $0.second == 0 }) else { return .time }
        guard parts.allSatisfy({ $0.day == 1 }) else { return .day }
        return parts.allSatisfy({ $0.month == 1 }) && dates.count > 1 ? .year : .month
    }
}

/// How a chart's data is exported: byte-faithful, or safe to open in a spreadsheet.
public enum CSVMode: Sendable {
    case raw
    /// Formula-like text is quoted behind a tab so spreadsheets read it as text.
    case spreadsheet
}

extension ChartSpec {
    /// The chart's data as CSV, as the web exports it (`chart-export.ts`).
    /// Columns follow `config.columns` or the encoding, then the rest by name.
    /// Nil for a chart without tabular data.
    public func csv(_ mode: CSVMode) -> String? {
        if type == "histogram" {
            let bins = data["bins"]?.arrayValue ?? []
            let rows = bins.map { bin in ["start", "end", "count"].map { bin[$0] ?? .null } }
            let header: [JSONValue] = [.string("bin_start"), .string("bin_end"), .string("count")]
            return Self.csv(header: header, rows: rows, mode: mode)
        }
        guard case .object(let all)? = data["columns"], !all.isEmpty else { return nil }
        var names = config["columns"]?.arrayValue?.compactMap(\.stringValue).filter { all[$0] != nil } ?? []
        for role in ["x", "color", "names", "y", "values", "error_y_low", "error_y_high", "size"] {
            if let name = config["encoding"]?[role]?.stringValue, all[name] != nil, !names.contains(name) {
                names.append(name)
            }
        }
        names += all.keys.filter { !names.contains($0) }.sorted(by: ChartAppearance.codeUnitOrder)
        let columns = names.map { all[$0]?["values"]?.arrayValue ?? [] }
        let count = columns.map(\.count).max() ?? 0
        let rows = (0..<count).map { row in columns.map { $0.indices.contains(row) ? $0[row] : .null } }
        return Self.csv(header: names.map(JSONValue.string), rows: rows, mode: mode)
    }

    static func csv(header: [JSONValue], rows: [[JSONValue]], mode: CSVMode) -> String {
        ([header] + rows).map { $0.map { field($0, mode) }.joined(separator: ",") }.joined(separator: "\n")
    }

    static func field(_ value: JSONValue, _ mode: CSVMode) -> String {
        guard value != .null else { return "" }
        var text = value.display
        var isText = false
        if case .string = value { isText = true }
        var quote = text.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" })
        if mode == .spreadsheet && isText {
            quote = true
            let units = Array(text.utf16)
            let content = text.drop { $0.unicodeScalars.allSatisfy { $0.value <= 32 } || $0.isWhitespace }
            let formula = content.first.map { "=+-@＝＋－＠".contains($0) } ?? false
            let control = units.first.map { [0, 9, 10, 13].contains($0) } ?? false
            if formula || control { text = "\t" + text }
        }
        return quote ? "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : text
    }
}
