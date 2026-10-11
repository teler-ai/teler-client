import Foundation

/// The block structure of an answer's markdown: paragraphs, headings, lists,
/// tables, code and quotes. Inline formatting (bold, links, code spans) stays
/// in each block's text for the app to render. It follows the common
/// GitHub-flavored forms Teler writes, and never fails: anything it doesn't
/// recognize is a paragraph. An unfinished block while an answer streams is
/// shown as far as it got.
public enum MarkdownBlock: Sendable, Hashable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case bulletList([String])
    case numberedList(start: Int, items: [String])
    case table(MarkdownTable)
    case code(language: String?, text: String)
    case quote(String)
    case rule

    public static func parse(_ markdown: String) -> [MarkdownBlock] {
        var parser = Parser(lines: markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n"))
        return parser.parse()
    }
}

public struct MarkdownTable: Sendable, Hashable {
    public enum Alignment: Sendable, Hashable {
        case leading
        case center
        case trailing
    }

    public let header: [String]
    public let alignments: [Alignment]
    public let rows: [[String]]

    /// Every row has the header's number of cells.
    public init(header: [String], alignments: [Alignment], rows: [[String]]) {
        self.header = header
        self.alignments = alignments
        self.rows = rows.map { row in
            Array(row.prefix(header.count)) + Array(repeating: "", count: max(0, header.count - row.count))
        }
    }
}

private struct Parser {
    let lines: [String]
    var index = 0
    var blocks: [MarkdownBlock] = []
    var paragraph: [String] = []

    init(lines: [String]) {
        self.lines = lines
    }

    mutating func parse() -> [MarkdownBlock] {
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                index += 1
            } else if let fence = Self.fence(trimmed) {
                flushParagraph()
                readCode(fence: fence, language: String(trimmed.dropFirst(fence.count)))
            } else if let heading = Self.heading(trimmed) {
                flushParagraph()
                blocks.append(heading)
                index += 1
            } else if Self.isRule(trimmed) {
                flushParagraph()
                blocks.append(.rule)
                index += 1
            } else if trimmed.hasPrefix(">") {
                flushParagraph()
                readQuote()
            } else if Self.bullet(trimmed) != nil {
                flushParagraph()
                readBullets()
            } else if Self.number(trimmed) != nil {
                flushParagraph()
                readNumbers()
            } else if trimmed.contains("|"), index + 1 < lines.count,
                let alignments = Self.delimiterRow(lines[index + 1])
            {
                flushParagraph()
                readTable(alignments: alignments)
            } else {
                paragraph.append(trimmed)
                index += 1
            }
        }
        flushParagraph()
        return blocks
    }

    private mutating func flushParagraph() {
        guard !paragraph.isEmpty else { return }
        blocks.append(.paragraph(paragraph.joined(separator: "\n")))
        paragraph = []
    }

    private mutating func readCode(fence: String, language: String) {
        index += 1
        var code: [String] = []
        while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
            code.append(lines[index])
            index += 1
        }
        index += 1  // the closing fence, if there is one yet
        let language = language.trimmingCharacters(in: .whitespaces)
        blocks.append(.code(language: language.isEmpty ? nil : language, text: code.joined(separator: "\n")))
    }

    private mutating func readQuote() {
        var quoted: [String] = []
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix(">") else { break }
            quoted.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
            index += 1
        }
        blocks.append(.quote(quoted.joined(separator: "\n")))
    }

    private mutating func readBullets() {
        var items: [String] = []
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            if let item = Self.bullet(trimmed) {
                items.append(item)
            } else if !trimmed.isEmpty, !items.isEmpty, lines[index].hasPrefix("  "),
                Self.number(trimmed) == nil
            {
                items[items.count - 1] += "\n" + trimmed  // an item's continued line
            } else {
                break
            }
            index += 1
        }
        blocks.append(.bulletList(items))
    }

    private mutating func readNumbers() {
        var items: [String] = []
        var start = 1
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            if let (number, item) = Self.number(trimmed) {
                if items.isEmpty { start = number }
                items.append(item)
            } else if !trimmed.isEmpty, !items.isEmpty, lines[index].hasPrefix("  "),
                Self.bullet(trimmed) == nil
            {
                items[items.count - 1] += "\n" + trimmed
            } else {
                break
            }
            index += 1
        }
        blocks.append(.numberedList(start: start, items: items))
    }

    private mutating func readTable(alignments: [MarkdownTable.Alignment]) {
        let header = Self.cells(lines[index])
        index += 2
        var rows: [[String]] = []
        while index < lines.count {
            let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("|") || (trimmed.contains("|") && !trimmed.isEmpty) else { break }
            rows.append(Self.cells(trimmed))
            index += 1
        }
        let aligned = Array(alignments.prefix(header.count))
            + Array(repeating: .leading, count: max(0, header.count - alignments.count))
        blocks.append(.table(MarkdownTable(header: header, alignments: aligned, rows: rows)))
    }

    // MARK: Line shapes

    static func fence(_ line: String) -> String? {
        if line.hasPrefix("```") { return "```" }
        if line.hasPrefix("~~~") { return "~~~" }
        return nil
    }

    static func heading(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        let text = line.dropFirst(hashes).trimmingCharacters(in: .whitespaces)
        return .heading(level: hashes, text: text.trimmingCharacters(in: CharacterSet(charactersIn: "# ")))
    }

    static func isRule(_ line: String) -> Bool {
        let compact = line.replacingOccurrences(of: " ", with: "")
        guard compact.count >= 3, let mark = compact.first, "-*_".contains(mark) else { return false }
        return compact.allSatisfy { $0 == mark }
    }

    static func bullet(_ line: String) -> String? {
        for marker in ["- ", "* ", "+ ", "• "] where line.hasPrefix(marker) {
            return String(line.dropFirst(marker.count))
        }
        return nil
    }

    static func number(_ line: String) -> (Int, String)? {
        let digits = line.prefix { $0.isNumber }
        guard (1...9).contains(digits.count), let number = Int(digits) else { return nil }
        let rest = line.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")", rest.dropFirst().first == " " else { return nil }
        return (number, String(rest.dropFirst(2)))
    }

    /// `| --- | :---: | ---: |`, which makes the line above a table's header.
    static func delimiterRow(_ line: String) -> [MarkdownTable.Alignment]? {
        let cells = cells(line)
        guard !cells.isEmpty else { return nil }
        var alignments: [MarkdownTable.Alignment] = []
        for cell in cells {
            let core = cell.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            guard core.count >= 1, core.allSatisfy({ $0 == "-" }) else { return nil }
            switch (cell.hasPrefix(":"), cell.hasSuffix(":")) {
            case (true, true): alignments.append(.center)
            case (false, true): alignments.append(.trailing)
            default: alignments.append(.leading)
            }
        }
        return alignments
    }

    static func cells(_ line: String) -> [String] {
        var row = line.trimmingCharacters(in: .whitespaces)
        if row.hasPrefix("|") { row.removeFirst() }
        if row.hasSuffix("|") { row.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        for character in row {
            if escaped {
                // Only an escaped pipe is the table's; keep other escapes for inline markdown.
                if character != "|" { current.append("\\") }
                current.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "|" {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(character)
            }
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }
}
