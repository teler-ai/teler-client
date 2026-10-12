import SwiftUI

/// A chart's exact values in a grid that scrolls sideways. Touch and hold a
/// value to copy it.
struct ChartValuesTable: View {
    struct Content {
        let header: [String]
        let rows: [[String]]
        /// Number columns align to the trailing edge.
        let numeric: [Bool]
    }

    let table: Content

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(table.header.indices, id: \.self) { column in
                        cell(table.header[column], column: column, isHeader: true)
                            .gridColumnAlignment(isNumeric(column) ? .trailing : .leading)
                    }
                }
                ForEach(table.rows.indices, id: \.self) { row in
                    Divider().gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(table.rows[row].indices, id: \.self) { column in
                            cell(table.rows[row][column], column: column, isHeader: false)
                        }
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .background(Palette.card, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
    }

    private func isNumeric(_ column: Int) -> Bool {
        table.numeric.indices.contains(column) && table.numeric[column]
    }

    private func cell(_ text: String, column: Int, isHeader: Bool) -> some View {
        Text(text)
            .font(isHeader ? .footnote.weight(.semibold) : .subheadline)
            .monospacedDigit()
            .foregroundStyle(isHeader ? Palette.mutedForeground : Palette.foreground)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, isHeader ? 9 : 11)
            .contextMenu {
                if !isHeader && !text.isEmpty {
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
                }
            }
    }
}
