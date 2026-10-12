import SwiftUI
import TelerKit

/// `[[artifact:slug]]` lines in Teler's markdown place a chart there.
enum ArtifactMarkers {
    enum Piece {
        case markdown(String)
        case chart(String)
    }

    static func split(_ text: String) -> [Piece] {
        var pieces: [Piece] = []
        var current: [String] = []
        for line in text.components(separatedBy: "\n") {
            if let slug = slug(line) {
                if !current.isEmpty { pieces.append(.markdown(current.joined(separator: "\n"))) }
                current = []
                pieces.append(.chart(slug))
            } else {
                current.append(line)
            }
        }
        let rest = current.joined(separator: "\n")
        if !rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { pieces.append(.markdown(rest)) }
        return pieces
    }

    static func slugs(in text: String) -> [String] {
        text.components(separatedBy: "\n").compactMap(slug)
    }

    static func slug(_ line: String) -> String? {
        let line = line.trimmingCharacters(in: .whitespaces)
        guard line.hasPrefix("[[artifact:"), line.hasSuffix("]]") else { return nil }
        let slug = line.dropFirst("[[artifact:".count).dropLast(2)
        return slug.isEmpty ? nil : String(slug)
    }
}

/// A report, read like a document: its title, reading time and date, its
/// charts in place, and a contents sheet that jumps to any section.
struct ReportReader: View {
    struct Report {
        let title: String
        let markdown: String
        var date: Date?
        /// The answer's charts, which the report places by slug.
        var charts: [ChartReference] = []
        let chat: ChatID
        let client: TelerAPIClient
        var webURL: URL?
    }

    /// One thing the reader shows, with the id the contents jump to.
    struct Element: Identifiable {
        enum Kind {
            case block(MarkdownBlock)
            case chart(ChartReference)
        }

        let id: Int
        let kind: Kind
    }

    let report: Report
    @State private var showsContents = false
    @State private var visible = Set<Int>()

    private var title: String { report.title.isEmpty ? String(localized: "Report") : report.title }

    var body: some View {
        let elements = Self.elements(report)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    header.id(-1)
                    ForEach(elements) { element in
                        switch element.kind {
                        case .block(let block):
                            MarkdownBlockView(block: block)
                        case .chart(let chart):
                            ChartCard(chart: report.chat, reference: chart, client: report.client, webURL: report.webURL)
                        }
                    }
                }
                .scrollTargetLayout()
                .padding(16)
            }
            .onScrollTargetVisibilityChange(idType: Int.self) { ids in visible = Set(ids) }
            .background(Palette.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !Self.sections(elements).isEmpty {
                        Button("Contents", systemImage: "list.bullet") { showsContents = true }
                    }
                    ShareLink(item: "\(title)\n\n\(report.markdown)") {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    if let webURL = report.webURL {
                        Menu {
                            Link(destination: webURL) { Label("Open on the web", systemImage: "safari") }
                            Button("Copy link", systemImage: "link") { UIPasteboard.general.url = webURL }
                        } label: {
                            Label("More", systemImage: "ellipsis")
                        }
                    }
                }
            }
            .sheet(isPresented: $showsContents) {
                ReportContents(sections: Self.sections(elements), current: current(elements)) { id in
                    showsContents = false
                    withAnimation { proxy.scrollTo(id, anchor: .top) }
                }
                .presentationDetents([.medium, .large])
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Self.meta(report.markdown))
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
            Text(title)
                .displayFont(28, relativeTo: .title1)
                .foregroundStyle(Palette.foreground)
            Text(byline)
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.bottom, 4)
    }

    private var byline: String {
        guard let date = report.date else { return String(localized: "Prepared by Teler") }
        return String(localized: "Prepared by Teler · \(date.formatted(date: .abbreviated, time: .omitted))")
    }

    /// The section being read: the last heading above the top of what's visible.
    private func current(_ elements: [Element]) -> Int? {
        guard let top = visible.min() else { return nil }
        return Self.sections(elements).last { $0.id <= top }?.id
            ?? Self.sections(elements).first { visible.contains($0.id) }?.id
    }

    static func elements(_ report: Report) -> [Element] {
        var elements: [Element] = []
        for piece in ArtifactMarkers.split(report.markdown) {
            switch piece {
            case .markdown(let markdown):
                for block in MarkdownBlock.parse(markdown) {
                    elements.append(Element(id: elements.count, kind: .block(block)))
                }
            case .chart(let slug):
                let chart =
                    report.charts.first { $0.slug == slug }
                    ?? ChartReference(slug: slug, chartType: "", title: String(localized: "Chart"))
                elements.append(Element(id: elements.count, kind: .chart(chart)))
            }
        }
        return elements
    }

    /// The report's main headings, as the contents list them.
    static func sections(_ elements: [Element]) -> [ReportContents.Section] {
        elements.compactMap { element in
            guard case .block(.heading(let level, let text)) = element.kind, level <= 2 else { return nil }
            let plain = String(MarkdownText.attributed(text).characters)
            return ReportContents.Section(id: element.id, title: plain)
        }
    }

    /// "Report · 6 min read · 6 sections", at about 220 words a minute.
    static func meta(_ markdown: String) -> String {
        let sections = MarkdownBlock.parse(markdown).filter {
            if case .heading = $0 { true } else { false }
        }.count
        let words = markdown.split(whereSeparator: \.isWhitespace).count
        let minutes = max(1, Int((Double(words) / 220).rounded()))
        var parts = [String(localized: "Report"), String(localized: "\(minutes) min read")]
        if sections > 1 { parts.append(String(localized: "\(sections) sections")) }
        return parts.joined(separator: " · ")
    }

    /// The first paragraph's words, without markdown.
    static func summary(_ markdown: String) -> String {
        for block in MarkdownBlock.parse(markdown) {
            if case .paragraph(let text) = block {
                return String(MarkdownText.attributed(text).characters).replacingOccurrences(of: "\n", with: " ")
            }
        }
        return ""
    }
}

/// The report's sections, marking where the reader is; choosing one jumps there.
struct ReportContents: View {
    struct Section: Identifiable {
        let id: Int
        let title: String
    }

    let sections: [Section]
    let current: Int?
    let jump: (Int) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Button {
                    jump(-1)
                } label: {
                    Text("Summary").foregroundStyle(Palette.foreground)
                }
                ForEach(sections) { section in
                    Button {
                        jump(section.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.title)
                                .font(section.id == current ? .body.weight(.semibold) : .body)
                                .foregroundStyle(Palette.foreground)
                            if section.id == current {
                                Text("You're here").font(.footnote).foregroundStyle(Palette.primaryInk)
                            }
                        }
                    }
                    .accessibilityAddTraits(section.id == current ? .isSelected : [])
                }
            }
            .navigationTitle("Contents")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
        }
    }
}
