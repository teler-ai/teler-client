import Foundation
import Testing

@testable import TelerKit

/// Charts read like the web: the same colors, the same refusals and the same exports.
@Suite struct ChartTests {
    private func spec(_ json: String) throws -> ChartSpec {
        try #require(ChartSpec(json: try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))))
    }

    private func line(extra: String = "") throws -> ChartSpec {
        try spec(
            #"""
            {"version":1,"type":"line","config":{"encoding":{"x":"month","y":"revenue","color":"region"\#(extra)}},
             "data":{"columns":{
              "month":{"values":["2026-02-01","2026-01-01","2026-01-01","2026-02-01"],"dtype":"datetime"},
              "revenue":{"values":[12,10,7,9],"dtype":"number"},
              "region":{"values":["Spain","Spain","France","France"],"dtype":"string"}}}}
            """#)
    }

    // MARK: Colors

    @Test func colorsSeriesInSortedOrderWithoutARegistry() {
        let coloring = ChartAppearance().coloring(for: ["Spain", "France", "Germany"])
        #expect(coloring.color("France") == .palette(nil, 0))
        #expect(coloring.color("Germany") == .palette(nil, 1))
        #expect(coloring.color("Spain") == .palette(nil, 2))
        #expect(coloring.legendOrder == ["France", "Germany", "Spain"])
    }

    @Test func keepsSavedSlotsAndAppendsNewSeriesSorted() {
        let coloring = ChartAppearance(domain: ["Spain", "France"]).coloring(for: ["Italy", "France", "Germany", "Spain"])
        #expect(coloring.color("Spain") == .palette(nil, 0))
        #expect(coloring.color("France") == .palette(nil, 1))
        #expect(coloring.color("Germany") == .palette(nil, 2))
        #expect(coloring.color("Italy") == .palette(nil, 3))
    }

    @Test func colorsOnlyFocusedSeries() {
        let coloring = ChartAppearance(focus: ["Spain"]).coloring(for: ["France", "Spain", "Italy"])
        #expect(coloring.color("Spain") == .palette(nil, 0))
        #expect(coloring.color("France") == .neutral(0))
        #expect(coloring.color("Italy") == .neutral(1))
        #expect(coloring.legendOrder == ["Spain", "France", "Italy"])
    }

    @Test func pinsOverridesAndReadsPalettes() {
        let json = try! JSONDecoder().decode(
            JSONValue.self,
            from: Data(##"{"version":1,"palette":"tableau10","reverse":true,"overrides":{"UK":"#112233"}}"##.utf8))
        let appearance = ChartAppearance(json: json)
        let coloring = appearance.coloring(for: ["UK", "France", "Spain"])
        #expect(coloring.color("UK") == .hex(0x112233))
        #expect(coloring.color("France") == .palette("tableau10", 9))
        #expect(ChartAppearance(palette: .named("blues")).coloring(for: ["A"]).color("A") == .palette(nil, 0))
        #expect(ChartAppearance(palette: .custom([0xAA0000, 0x00AA00])).coloring(for: ["A", "B"]).color("B") == .hex(0x00AA00))
    }

    @Test func turnsSeriesBeyondSevenNeutral() {
        let keys = (0..<10).map { "s\($0)" }
        let coloring = ChartAppearance().coloring(for: keys)
        #expect(coloring.color("s6") == .palette(nil, 6))
        #expect(coloring.color("s7") == .neutral(0))
        #expect(coloring.color("s9") == .neutral(2))
    }

    @Test func colorsBarsByCategoryInDrawingOrder() throws {
        let bars = try spec(
            #"""
            {"version":1,"type":"bar","config":{"encoding":{"x":"product","y":"revenue","color":"product"}},
             "data":{"columns":{"product":{"values":["Weft","Loom"],"dtype":"string"},
              "revenue":{"values":[3,2],"dtype":"number"}}}}
            """#)
        #expect(bars.series.count == 1)
        #expect(bars.series[0].points.map(\.colorKey) == ["Weft", "Loom"])
        let coloring = bars.appearance.coloring(for: ["Weft", "Loom"], drawn: true)
        #expect(coloring.color("Weft") == .palette(nil, 0))
        #expect(coloring.color("Loom") == .palette(nil, 1))
    }

    @Test func keysMissingAndEscapedCategories() {
        #expect(ChartCategory.key(.null) == "~missing")
        #expect(ChartCategory.label("~missing") == "—")
        #expect(ChartCategory.key(.string("a~b")) == "a~~b")
        #expect(ChartCategory.label("a~~b") == "a~b")
        #expect(ChartCategory.key(.number(3)) == "3")
    }

    // MARK: What can't be drawn

    @Test func refusesWhatTheWebRefuses() throws {
        #expect(try line().limitation == nil)
        #expect(try line(extra: #","facet_col":"country""#).limitation == .facets)
        let annotated = try spec(
            #"{"version":1,"type":"scatter","config":{"encoding":{"x":"a","y":"b"},"annotations":[{"kind":"hline","y":1}]},"data":{"columns":{}}}"#)
        #expect(annotated.limitation == .annotations)
        let colored = try spec(
            ##"{"version":1,"type":"line","config":{"encoding":{"x":"a","y":"b"},"colors":["#ff0000"]},"data":{"columns":{}}}"##)
        #expect(colored.limitation == .colors)
        let repeated = try spec(
            #"""
            {"version":1,"type":"line","config":{"encoding":{"x":"stage","y":"n"}},
             "data":{"columns":{"stage":{"values":["Lead","Lead"],"dtype":"string"},"n":{"values":[1,2],"dtype":"number"}}}}
            """#)
        #expect(repeated.limitation == .ambiguousCategories)
    }

    // MARK: Reading values

    @Test func readsValuesBySeriesAndPosition() throws {
        let grid = try #require(ChartGrid(spec: try line()))
        #expect(grid.series.map(\.name) == ["Spain", "France"])
        guard case .date(let first) = grid.xs[0], case .date(let second) = grid.xs[1] else {
            Issue.record("Expected dates on x")
            return
        }
        #expect(first < second)
        #expect(grid.value(series: 0, at: 0) == 10)
        #expect(grid.value(series: 1, at: 1) == 9)
        #expect(grid.total(at: 0) == 17)
        #expect(grid.change(series: 0, at: 1) == 0.2)
        #expect(grid.nearest(to: .date(second.addingTimeInterval(3600))) == 1)
    }

    @Test func infersHowFinelyDatesAreSpaced() {
        let day = { (text: String) in try! Date(text, strategy: .iso8601) }
        #expect(DateGranularity.of([day("2026-01-01T00:00:00Z"), day("2026-02-01T00:00:00Z")]) == .month)
        #expect(DateGranularity.of([day("2025-01-01T00:00:00Z"), day("2026-01-01T00:00:00Z")]) == .year)
        #expect(DateGranularity.of([day("2026-01-01T00:00:00Z"), day("2026-01-02T00:00:00Z")]) == .day)
        #expect(DateGranularity.of([day("2026-01-01T09:30:00Z")]) == .time)
    }

    // MARK: Exporting

    @Test func exportsCSVLikeTheWeb() throws {
        let table = try spec(
            #"""
            {"version":1,"type":"table","config":{"columns":["name","amount"]},
             "data":{"columns":{"amount":{"values":[-12,3.5],"dtype":"number"},
              "name":{"values":["=1+1","Smith, \"J\""],"dtype":"string"},
              "note":{"values":[null],"dtype":"string"}}}}
            """#)
        #expect(table.csv(.raw) == "name,amount,note\n=1+1,-12,\n\"Smith, \"\"J\"\"\",3.5,")
        #expect(
            table.csv(.spreadsheet)
                == "\"name\",\"amount\",\"note\"\n\"\t=1+1\",-12,\n\"Smith, \"\"J\"\"\",3.5,")
    }

    @Test func refusesAnIncompletePie() throws {
        let pie = { (values: String) in
            try self.spec(
                #"""
                {"version":1,"type":"pie","config":{"encoding":{"names":"n","values":"v"}},
                 "data":{"columns":{"n":{"values":["A","B"],"dtype":"string"},"v":{"values":\#(values),"dtype":"number"}}}}
                """#)
        }
        #expect(try pie("[1,null]").slices.isEmpty)
        #expect(try pie("[1,-1]").slices.isEmpty)
        #expect(try pie("[1,3]").slices.map(\.value) == [1, 3])
    }
}
