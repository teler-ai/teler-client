import Testing

@testable import TelerKit

/// The block structure of answers as Teler writes them.
@Suite struct MarkdownTests {
    @Test func splitsParagraphsAndKeepsInlineMarkdown() {
        #expect(
            MarkdownBlock.parse("Revenue rose **8.4%**.\nSpain led.\n\nGermany fell.")
                == [.paragraph("Revenue rose **8.4%**.\nSpain led."), .paragraph("Germany fell.")])
    }

    @Test func readsHeadingsQuotesAndRules() {
        #expect(
            MarkdownBlock.parse("## Method\n> Based on 2.1M orders\n> since 2024\n\n---\nDone")
                == [
                    .heading(level: 2, text: "Method"), .quote("Based on 2.1M orders\nsince 2024"), .rule,
                    .paragraph("Done"),
                ])
        #expect(MarkdownBlock.parse("#hashtag") == [.paragraph("#hashtag")])
    }

    @Test func readsBulletAndNumberedLists() {
        let blocks = MarkdownBlock.parse(
            "Three things stood out:\n- **Spain** grew\n  mostly online\n- Germany fell\n\n3. Check accounts\n4. Compare Spain")
        #expect(
            blocks == [
                .paragraph("Three things stood out:"),
                .bulletList(["**Spain** grew\nmostly online", "Germany fell"]),
                .numberedList(start: 3, items: ["Check accounts", "Compare Spain"]),
            ])
    }

    @Test func readsTablesWithAlignmentAndUnevenRows() {
        let blocks = MarkdownBlock.parse(
            "| Region | Q3 | vs Q2 |\n|:---|---:|:---:|\n| Spain | €1.94M | +12.4% |\n| France | €1.06M |\n| A \\| B | 1 | 2 | 3 |")
        #expect(
            blocks == [
                .table(
                    MarkdownTable(
                        header: ["Region", "Q3", "vs Q2"], alignments: [.leading, .trailing, .center],
                        rows: [["Spain", "€1.94M", "+12.4%"], ["France", "€1.06M", ""], ["A | B", "1", "2"]]))
            ])
    }

    @Test func readsCodeEvenWhileItIsStillStreaming() {
        #expect(
            MarkdownBlock.parse("```sql\nselect region\nfrom orders\n```\nThat's the query.")
                == [.code(language: "sql", text: "select region\nfrom orders"), .paragraph("That's the query.")])
        #expect(MarkdownBlock.parse("```python\nimport pandas") == [.code(language: "python", text: "import pandas")])
    }

    @Test func treatsAPipeInProseAsProse() {
        #expect(MarkdownBlock.parse("Spain | France grew") == [.paragraph("Spain | France grew")])
    }
}
