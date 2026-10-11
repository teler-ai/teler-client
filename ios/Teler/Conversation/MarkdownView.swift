import SwiftUI
import TelerKit
import UIKit

/// An answer's markdown as native blocks: paragraphs, headings, lists, tables,
/// code and quotes.
struct MarkdownView: View {
    private let blocks: [MarkdownBlock]

    init(_ markdown: String) {
        blocks = MarkdownBlock.parse(markdown)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case .paragraph(let text):
            MarkdownText(text)
        case .heading(let level, let text):
            MarkdownText(text)
                .font(level <= 2 ? .title3.weight(.semibold) : .headline)
                .accessibilityAddTraits(.isHeader)
        case .bulletList(let items):
            ListBlock(items: items) { _ in "•" }
        case .numberedList(let start, let items):
            ListBlock(items: items) { "\(start + $0)." }
        case .table(let table):
            TableBlock(table: table)
        case .code(let language, let text):
            CodeBlock(language: language, text: text)
        case .quote(let text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(Palette.border).frame(width: 3)
                MarkdownText(text).foregroundStyle(Palette.mutedForeground)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .rule:
            Divider()
        }
    }
}

private struct ListBlock: View {
    let items: [String]
    let marker: (Int) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(marker(index))
                        .monospacedDigit()
                        .foregroundStyle(Palette.mutedForeground)
                        .accessibilityHidden(true)
                    MarkdownText(item)
                }
            }
        }
    }
}

/// A table as a card with a header row. One that fits spans the card, its
/// first column taking the room; a wider one scrolls sideways.
struct TableBlock: View {
    let table: MarkdownTable

    var body: some View {
        ViewThatFits(in: .horizontal) {
            grid(spread: true)
            ScrollView(.horizontal, showsIndicators: false) {
                grid(spread: false)
            }
        }
        .background(Palette.card, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border))
    }

    private func grid(spread: Bool) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(table.header.enumerated()), id: \.offset) { column, title in
                    cell(MarkdownText(title).font(.subheadline.weight(.semibold)), column: column, spread: spread)
                        .foregroundStyle(Palette.mutedForeground)
                        .gridColumnAlignment(alignment(column))
                }
            }
            .padding(.vertical, 10)
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
                Divider().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { column, value in
                        cell(MarkdownText(value).font(.subheadline).monospacedDigit(), column: column, spread: spread)
                            .foregroundStyle(Palette.foreground)
                    }
                }
                .padding(.vertical, 10)
            }
        }
        .padding(.horizontal, 14)
    }

    @ViewBuilder private func cell(_ content: some View, column: Int, spread: Bool) -> some View {
        if spread && column == 0 {
            content.frame(maxWidth: .infinity, alignment: .leading)
        } else {
            content.fixedSize()
        }
    }

    private func alignment(_ column: Int) -> HorizontalAlignment {
        switch table.alignments[column] {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}

/// Code, which Teler writes only when asked for it: monospaced, scrolling
/// sideways, with a Copy button.
struct CodeBlock: View {
    let language: String?
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language?.uppercased() ?? String(localized: "Code"))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                Spacer()
                Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.primaryInk)
                    .frame(minHeight: 44)
                    .padding(.trailing, 12)
            }
            .padding(.leading, 14)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Palette.foreground)
                    .textSelection(.enabled)
                    .fixedSize()
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
            }
        }
        .background(Palette.muted, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Palette.border, lineWidth: 0.5))
    }
}

/// Inline markdown (bold, italics, code, links) with line breaks kept.
struct MarkdownText: View {
    let source: String

    init(_ source: String) {
        self.source = source
    }

    var body: some View {
        Text(Self.attributed(source))
            .textSelection(.enabled)
    }

    static func attributed(_ source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}
