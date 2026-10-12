import Foundation

/// A chart, table or metric card's spec and data, version 1 of Teler's chart
/// format (`docs/charts-schema.md` in the Teler repository).
public struct ChartSpec: Sendable, Hashable {
    /// `line`, `bar`, `pie`, `scatter`, `histogram`, `table`, `metric`,
    /// `metric_grid`, or a type the app can't draw yet.
    public let type: String
    public let title: String?
    public let description: String?
    public let config: JSONValue
    public let data: JSONValue

    public init?(json: JSONValue) {
        guard json["version"]?.intValue == 1, let type = json["type"]?.stringValue else { return nil }
        self.type = type
        title = json["title"]?.stringValue
        description = json["description"]?.stringValue
        config = json["config"] ?? .null
        data = json["data"] ?? .null
    }

    /// The column named in `config.encoding[role]`, such as `x`, `y` or `color`.
    public func encoded(_ role: String) -> ChartColumn? {
        config["encoding"]?[role]?.stringValue.flatMap(column)
    }

    public func column(_ name: String) -> ChartColumn? {
        guard let raw = data["columns"]?[name], let values = raw["values"]?.arrayValue else { return nil }
        return ChartColumn(name: name, kind: ChartColumn.Kind(dtype: raw["dtype"]?.stringValue), values: values)
    }

    /// Every column in the data, in the order `config.columns` lists them when it does.
    public var columns: [ChartColumn] {
        guard case .object(let all)? = data["columns"] else { return [] }
        let listed = config["columns"]?.arrayValue?.compactMap(\.stringValue) ?? all.keys.sorted()
        return listed.compactMap(column)
    }

    /// How the chart's series take their colors.
    public var appearance: ChartAppearance { ChartAppearance(json: config["appearance"]) }

    /// The axis titles, when the chart names them.
    public var xLabel: String? { config["axes"]?["x_label"]?.stringValue }
    public var yLabel: String? { config["axes"]?["y_label"]?.stringValue }

    /// The x and y points of a line, bar or scatter chart. A color column makes
    /// one series per category when it names groups, as on the web; when each
    /// mark has its own category, there is one series and each point keeps its
    /// category in `colorKey`. Points with a missing value are skipped.
    public var series: [ChartSeries] {
        guard let x = encoded("x"), let y = encoded("y") else { return [] }
        let color = encoded("color")
        let grouped = color.map { namesSeries($0, x: x) } ?? false
        var order: [String] = []
        var points: [String: [ChartPoint]] = [:]
        for index in 0..<min(x.values.count, y.values.count) {
            guard let xValue = x.value(at: index), let yValue = y.values[index].doubleValue else { continue }
            let category = color.map { ChartCategory.key($0.values.indices.contains(index) ? $0.values[index] : .null) }
            let key = grouped ? category ?? y.name : y.name
            if points[key] == nil { order.append(key) }
            points[key, default: []].append(ChartPoint(x: xValue, y: yValue, colorKey: grouped ? nil : category))
        }
        return order.map { key in
            ChartSeries(key: key, name: grouped ? ChartCategory.label(key) : nil, points: points[key] ?? [])
        }
    }

    /// Whether a color column names groups of marks rather than each mark
    /// (`shouldPromoteColorToSeries` in the web's chart data transformer).
    private func namesSeries(_ color: ChartColumn, x: ChartColumn) -> Bool {
        if color.kind == .number || color.kind == .date { return false }
        let present = color.values.filter { $0 != .null }
        if present.isEmpty || present.allSatisfy({ $0.doubleValue != nil }) { return false }
        if type == "line", let registry = appearance.domain {
            let keys = Set(color.values.map(ChartCategory.key))
            if keys.isSubset(of: registry) { return true }
        }
        let xRepeats = Set(x.values.map(\.display)).count < x.values.count
        let stacked = type == "bar" && config["encoding"]?["stack"]?.boolValue == true
        return xRepeats || Set(present.map(\.display)).count < present.count || stacked
    }

    /// Why the chart can't be drawn faithfully, the web's rules for older
    /// charts (`chart-capabilities.ts`); nil when it can.
    public var limitation: ChartLimitation? {
        let encoding = config["encoding"]
        func present(_ value: JSONValue?) -> Bool {
            switch value {
            case .string(let text)?: !text.isEmpty
            case .array(let items)?: !items.isEmpty
            case nil, .null?: false
            default: true
            }
        }
        switch type {
        case "line":
            if present(encoding?["facet_col"]) || present(encoding?["facet_row"]) { return .facets }
            if present(config["annotations"]) { return .annotations }
            if present(config["colors"]) && config["appearance"] == nil { return .colors }
            return categoricalLineLimitation
        case "bar":
            return present(encoding?["facet_col"]) ? .facets : nil
        case "scatter":
            if present(encoding?["facet_col"]) { return .facets }
            return present(config["annotations"]) ? .annotations : nil
        default:
            return nil
        }
    }

    /// A line over categories needs one value per series and category, and
    /// at most 10,000 of those cells.
    private var categoricalLineLimitation: ChartLimitation? {
        guard let x = encoded("x"), x.kind == .text || x.kind == .boolean, encoded("y") != nil else { return nil }
        let color = encoded("color").flatMap { namesSeries($0, x: x) ? $0 : nil }
        func series(_ index: Int) -> String {
            guard let color else { return "" }
            return color.values.indices.contains(index) ? ChartCategory.key(color.values[index]) : ChartCategory.missing
        }
        var categories = Set<String>()
        var names = Set<String>()
        var seen = Set<[String]>()
        var repeated = false
        for (index, value) in x.values.enumerated() where value != .null {
            categories.insert(value.display)
            names.insert(series(index))
            if !seen.insert([series(index), value.display]).inserted { repeated = true }
        }
        if categories.count * names.count > 10_000 { return .tooManyMarks }
        return repeated ? .ambiguousCategories : nil
    }

    /// A pie's slices: the names and values columns. Like the web, a pie with
    /// a missing or negative value has no slices rather than wrong shares.
    public var slices: [ChartSlice] {
        guard let names = config["encoding"]?["names"]?.stringValue.flatMap(column),
            let values = config["encoding"]?["values"]?.stringValue.flatMap(column),
            names.values.count == values.values.count
        else { return [] }
        let numbers = values.values.map(\.doubleValue)
        guard numbers.allSatisfy({ ($0 ?? -1) >= 0 }), numbers.contains(where: { ($0 ?? 0) > 0 }) else {
            return []
        }
        return zip(names.values, numbers).map { name, value in
            let key = ChartCategory.key(name)
            return ChartSlice(key: key, name: ChartCategory.label(key), value: value ?? 0)
        }
    }
}

public struct ChartSlice: Sendable, Hashable {
    public let key: String
    public let name: String
    public let value: Double
}

public struct ChartColumn: Sendable, Hashable {
    public enum Kind: Sendable, Hashable {
        case number
        case text
        case date
        case boolean

        init(dtype: String?) {
            switch dtype {
            case "number": self = .number
            case "datetime": self = .date
            case "boolean": self = .boolean
            default: self = .text
            }
        }
    }

    public let name: String
    public let kind: Kind
    public let values: [JSONValue]

    public func value(at index: Int) -> ChartValue? {
        guard values.indices.contains(index) else { return nil }
        let value = values[index]
        switch kind {
        case .number: return value.doubleValue.map(ChartValue.number)
        case .date: return ChartValue.date(from: value) ?? (value == .null ? nil : .text(value.display))
        case .text, .boolean: return value == .null ? nil : .text(value.display)
        }
    }
}

public enum ChartValue: Sendable, Hashable {
    case number(Double)
    case text(String)
    case date(Date)

    static func date(from value: JSONValue) -> ChartValue? {
        if let milliseconds = value.doubleValue {
            return .date(Date(timeIntervalSince1970: milliseconds / 1000))
        }
        guard let text = value.stringValue else { return nil }
        if let date = try? Date(text, strategy: .iso8601) { return .date(date) }
        let day = Date.ISO8601FormatStyle().year().month().day()
        if let date = try? Date(String(text.prefix(10)), strategy: day) { return .date(date) }
        return nil
    }
}

public struct ChartPoint: Sendable, Hashable {
    public let x: ChartValue
    public let y: Double
    /// The mark's own category, when the color column colors each mark.
    public var colorKey: String?
}

public struct ChartSeries: Sendable, Hashable {
    /// The series' category key, or the y column's name for a chart with one series.
    public let key: String
    /// The legend's name for the series, or nil for a chart with one series.
    public let name: String?
    public let points: [ChartPoint]
}

/// Options older charts may carry that the app, like the web, can't draw faithfully.
public enum ChartLimitation: Sendable, Hashable {
    case facets
    case annotations
    case colors
    case tooManyMarks
    case ambiguousCategories
}

extension JSONValue {
    /// A cell's text: strings as they are, whole numbers without decimals.
    public var display: String {
        switch self {
        case .string(let text): return text
        case .number(let number):
            return number.rounded() == number && abs(number) < 1e15
                ? String(Int64(number)) : String(number)
        case .bool(let flag): return flag ? "true" : "false"
        case .null: return ""
        default: return ""
        }
    }

    public var doubleValue: Double? {
        if case .number(let number) = self { return number }
        return nil
    }
}

extension TelerAPIClient {
    /// A chart's spec and data. While an answer is still being written the
    /// data can lag its part by a few seconds, which shows as `.http(404)`.
    public func chartSpec(chat: ChatID, slug: String) async throws -> ChartSpec {
        guard (1...128).contains(slug.count),
            slug.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
        else { throw TelerAPIError.invalidResponse }
        let json = try await json(JSONValue.self, .get, "/api/chat/\(chat.rawValue)/artifact/\(slug)/data")
        guard let spec = ChartSpec(json: json) else { throw TelerAPIError.invalidResponse }
        return spec
    }
}
