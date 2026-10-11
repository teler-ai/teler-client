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

    /// The x and y points of a line, bar or scatter chart, one series per
    /// value of the color column. Points with a missing value are skipped.
    public var series: [ChartSeries] {
        guard let x = encoded("x"), let y = encoded("y") else { return [] }
        let color = encoded("color")
        var order: [String] = []
        var points: [String: [ChartPoint]] = [:]
        for index in 0..<min(x.values.count, y.values.count) {
            guard let xValue = x.value(at: index), let yValue = y.values[index].doubleValue else { continue }
            let name = color.flatMap { $0.values.indices.contains(index) ? $0.values[index].display : nil } ?? ""
            if points[name] == nil { order.append(name) }
            points[name, default: []].append(ChartPoint(x: xValue, y: yValue))
        }
        return order.map { ChartSeries(name: $0.isEmpty ? nil : $0, points: points[$0] ?? []) }
    }

    /// A pie's slices: the names and values columns.
    public var slices: [(name: String, value: Double)] {
        guard let names = config["encoding"]?["names"]?.stringValue.flatMap(column),
            let values = config["encoding"]?["values"]?.stringValue.flatMap(column)
        else { return [] }
        return zip(names.values, values.values).compactMap { name, value in
            guard let value = value.doubleValue else { return nil }
            return (name.display, value)
        }
    }
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
}

public struct ChartSeries: Sendable, Hashable {
    /// The color column's value, or nil for a chart with one series.
    public let name: String?
    public let points: [ChartPoint]
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
