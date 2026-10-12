import SwiftUI
import TelerFeatures
import TelerKit

/// One message: the member's question as a bubble, or Teler's answer with the
/// steps it took, the answer itself and what to ask next.
struct MessageView: View {
    let item: ConversationModel.Item
    let context: AnswerContext

    var body: some View {
        if item.role == .user {
            UserBubble(content: item.content)
        } else {
            AnswerView(item: item, context: context)
        }
    }
}

/// What an answer needs from its conversation.
struct AnswerContext {
    let chat: ChatID
    let client: TelerAPIClient
    let webURL: URL?
    /// The newest answer offers next questions and, after a failure, Retry.
    var isLatest = false
    var isOffline = false
    var progress: TaskProgress?
    var ask: (String) -> Void = { _ in }
    var retry: (() -> Void)?
    var editQuestion: (() -> Void)?
    /// Where each of Teler's questions stands, by tool call.
    var questionStatuses: [String: QuestionStatus] = [:]
    /// False in the read-only sample: nothing asks Teler anything.
    var canAsk = true
    /// While the running answer's stream is down: when it reconnects.
    var reconnectAt: Date?
    var lastEventAt: Date?
    var retryStream: (() -> Void)?
}

private struct UserBubble: View {
    let content: [ContentField]

    var body: some View {
        if let answers {
            // The text Teler reads repeats these answers; the receipt reads better.
            AnswersReceipt(answers: answers).frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            bubble
        }
    }

    private var answers: QuestionAnswers? {
        content.lazy.compactMap { field -> QuestionAnswers? in
            if case .questionAnswers(let answers) = field { return answers }
            return nil
        }.first
    }

    private var bubble: some View {
        VStack(alignment: .trailing, spacing: 6) {
            let files = content.compactMap { field -> (String?, Bool)? in
                if case .attachment(let name, let isImage) = field { return (name, isImage) }
                return nil
            }
            ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                Label(file.0 ?? String(localized: "Image"), systemImage: file.1 ? "photo" : "doc")
                    .font(.footnote)
                    .foregroundStyle(Palette.foreground)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 32)
                    .background(Palette.fill, in: .capsule)
            }
            HStack {
                Spacer(minLength: 48)
                Text(text)
                    .foregroundStyle(Palette.foreground)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Palette.bubble, in: .rect(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.bubbleEdge))
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var text: String {
        content.compactMap { field in
            if case .text(let text) = field { return text }
            return nil
        }.joined(separator: "\n")
    }
}

private struct AnswerView: View {
    let item: ConversationModel.Item
    let context: AnswerContext

    var body: some View {
        let layout = AnswerLayout(content: item.content)
        let stopped = layout.error.map { ["cancelled", "interrupted", "analysis_timeout"].contains($0.code ?? "") } ?? false
        VStack(alignment: .leading, spacing: 14) {
            if !layout.steps.isEmpty {
                WorkCard(
                    steps: layout.steps, isStreaming: item.isStreaming, isWriting: layout.isWriting,
                    isStopped: stopped && !layout.isWriting, startedAt: item.createdAt,
                    finishedAt: item.completedAt, progress: context.progress, isOffline: context.isOffline,
                    replaced: layout.replacedSteps, reconnectAt: item.isStreaming ? context.reconnectAt : nil,
                    lastEventAt: context.lastEventAt, retry: context.retryStream)
            } else if item.isStreaming && !layout.isWriting {
                if let reconnectAt = context.reconnectAt {
                    ReconnectingLine(at: reconnectAt, retry: context.retryStream)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Teler is starting…")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
            }
            AnswerParts(parts: layout.answer, context: context, isStreaming: item.isStreaming)
            if let error = layout.error, !item.isStreaming {
                ErrorCard(error: error, context: context)
            }
            if context.isLatest, context.canAsk, !item.isStreaming, !layout.nextQuestions.isEmpty {
                NextQuestions(questions: layout.nextQuestions, ask: context.ask)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The answer's parts in order, with each chart where the text places it.
private struct AnswerParts: View {
    let parts: [ContentField]
    let context: AnswerContext
    let isStreaming: Bool

    var body: some View {
        let charts = parts.compactMap { field -> ChartReference? in
            if case .chart(let chart) = field { return chart }
            return nil
        }
        let placed = Set(parts.flatMap { field -> [String] in
            if case .text(let text) = field { return Self.placedSlugs(text) }
            return []
        })
        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
            switch group {
            case .text(let text):
                ForEach(Array(Self.split(text).enumerated()), id: \.offset) { _, piece in
                    switch piece {
                    case .markdown(let markdown):
                        MarkdownView(markdown)
                    case .chart(let slug):
                        if let chart = charts.first(where: { $0.slug == slug }) {
                            chartCard(chart)
                        }
                    }
                }
            case .chart(let chart) where !placed.contains(chart.slug):
                chartCard(chart)
            case .chart:
                EmptyView()
            case .report(let title, let markdown):
                ReportCard(title: title, markdown: markdown)
            case .sources(let sources):
                SourcesView(sources: sources)
            case .steering(let text):
                Label("You added: “\(text)”", systemImage: "arrowshape.turn.up.right")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
            case .question(let call):
                QuestionRecord(call: call, status: context.questionStatuses[call.toolCallID])
            case .approval(let request):
                ApprovalCard(request: request, webURL: context.webURL, isLatest: context.isLatest)
            case .webOnly(let count):
                WebOnlyNotice(count: count, webURL: context.webURL)
            }
        }
    }

    private func chartCard(_ chart: ChartReference) -> some View {
        ChartCard(
            chart: context.chat, reference: chart, client: context.client, isStreaming: isStreaming,
            webURL: context.webURL)
    }

    private enum Group {
        case text(String)
        case chart(ChartReference)
        case report(title: String, markdown: String)
        case sources([WebSource])
        case steering(String)
        case question(AskUserCall)
        case approval(ApprovalRequest)
        case webOnly(Int)
    }

    /// Consecutive parts the app can't show yet collapse into one notice.
    private var groups: [Group] {
        var groups: [Group] = []
        for field in parts {
            switch field {
            case .text(let text): groups.append(.text(text))
            case .chart(let chart): groups.append(.chart(chart))
            case .report(let title, let markdown): groups.append(.report(title: title, markdown: markdown))
            case .webSources(let sources): groups.append(.sources(sources))
            case .steering(let text, _): groups.append(.steering(text))
            case .question(let call): groups.append(.question(call))
            case .approval(let request): groups.append(.approval(request))
            case .unknown:
                if case .webOnly(let count)? = groups.last {
                    groups[groups.count - 1] = .webOnly(count + 1)
                } else {
                    groups.append(.webOnly(1))
                }
            default: continue
            }
        }
        return groups
    }

    private enum Piece {
        case markdown(String)
        case chart(String)
    }

    /// Text with `[[artifact:slug]]` lines, which place a chart there.
    private static func split(_ text: String) -> [Piece] {
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

    private static func placedSlugs(_ text: String) -> [String] {
        text.components(separatedBy: "\n").compactMap(slug)
    }

    private static func slug(_ line: String) -> String? {
        let line = line.trimmingCharacters(in: .whitespaces)
        guard line.hasPrefix("[[artifact:"), line.hasSuffix("]]") else { return nil }
        let slug = line.dropFirst("[[artifact:".count).dropLast(2)
        return slug.isEmpty ? nil : String(slug)
    }
}

/// A report: its title and first words, opening the reader.
private struct ReportCard: View {
    let title: String
    let markdown: String

    var body: some View {
        NavigationLink {
            ReportReader(title: title, markdown: markdown)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.richtext")
                    .font(.title3)
                    .foregroundStyle(Palette.primaryInk)
                    .frame(width: 44, height: 52)
                    .background(Palette.fill, in: .rect(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title.isEmpty ? String(localized: "Report") : title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                        .lineLimit(2)
                    Text(ReportReader.summary(markdown))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(2)
                    Text(ReportReader.meta(markdown))
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.tertiary)
            }
            .padding(12)
            .background(Palette.card, in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        }
        .buttonStyle(.plain)
    }
}

/// A report to read on its own page.
struct ReportReader: View {
    let title: String
    let markdown: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title.isEmpty ? String(localized: "Report") : title)
                        .displayFont(28, relativeTo: .title1)
                        .foregroundStyle(Palette.foreground)
                    Text(Self.meta(markdown))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
                MarkdownView(markdown)
            }
            .padding(16)
        }
        .background(Palette.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: "\(title)\n\n\(markdown)") {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    /// "Report · 6 sections · 6 min read", at about 220 words a minute.
    static func meta(_ markdown: String) -> String {
        let sections = MarkdownBlock.parse(markdown).filter {
            if case .heading = $0 { true } else { false }
        }.count
        let words = markdown.split(whereSeparator: \.isWhitespace).count
        let minutes = max(1, Int((Double(words) / 220).rounded()))
        var parts = [String(localized: "Report")]
        if sections > 1 { parts.append(String(localized: "\(sections) sections")) }
        parts.append(String(localized: "\(minutes) min read"))
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

/// The web pages an answer drew on, behind one chip.
private struct SourcesView: View {
    let sources: [WebSource]
    @State private var isOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { isOpen.toggle() }
            } label: {
                Label(
                    sources.count == 1 ? String(localized: "1 source") : String(localized: "\(sources.count) sources"),
                    systemImage: "globe"
                )
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .padding(.horizontal, 12)
                .frame(minHeight: 32)
                .background(Palette.fill, in: .capsule)
            }
            .buttonStyle(.plain)
            .frame(minHeight: 44)
            if isOpen {
                ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                    if let url = URL(string: source.url), url.scheme == "https" || url.scheme == "http" {
                        Link(destination: url) {
                            Text(source.title ?? url.host() ?? source.url)
                                .font(.footnote)
                                .lineLimit(1)
                        }
                        .foregroundStyle(Palette.primaryInk)
                    }
                }
            }
        }
    }
}

/// Why an answer stopped or failed, in plain words, with what to do next.
private struct ErrorCard: View {
    let error: ContentError
    let context: AnswerContext

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.foreground)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
            if context.isLatest, error.code != "org_membership_lost", error.code != "plan_inactive" {
                HStack(spacing: 10) {
                    if let retry = context.retry {
                        Button("Retry", systemImage: "arrow.clockwise", action: retry)
                            .buttonStyle(.glass)
                    }
                    if let editQuestion = context.editQuestion {
                        Button("Edit question", action: editQuestion)
                            .buttonStyle(.glass)
                    }
                }
                .font(.subheadline.weight(.semibold))
                .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
    }

    private var symbol: String {
        switch error.code {
        case "analysis_timeout": "hourglass"
        case "cancelled": "stop.circle"
        default: "exclamationmark.triangle"
        }
    }

    private var title: String {
        switch error.code {
        case "analysis_timeout": String(localized: "This analysis took too long")
        case "cancelled": String(localized: "You stopped this analysis")
        case "interrupted": String(localized: "This analysis was interrupted")
        case "provider_down": String(localized: "Teler's AI provider isn't responding")
        case "plan_inactive": String(localized: "Your organization's plan isn't active")
        case "org_membership_lost": String(localized: "You're no longer in this organization")
        default:
            error.text == "NO_CREDITS"
                ? String(localized: "Your organization is out of AI credits")
                : String(localized: "This answer didn't finish")
        }
    }

    private var detail: String {
        switch error.code {
        case "analysis_timeout":
            String(localized: "It stopped safely before finishing. Try again, or ask a narrower question.")
        case "cancelled":
            String(localized: "Ask again whenever you like.")
        case "interrupted", "provider_down":
            String(localized: "Nothing was lost. Try again in a moment.")
        case "plan_inactive", "org_membership_lost":
            String(localized: "An admin of your organization can sort this out on the web.")
        default:
            error.text == "NO_CREDITS"
                ? String(localized: "An admin of your organization can sort this out on the web.")
                : String(localized: "Try again, or ask it another way.")
        }
    }
}

/// Questions Teler suggests asking next.
private struct NextQuestions: View {
    let questions: [QuickAction]
    let ask: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What's next")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.mutedForeground)
            ForEach(questions, id: \.self) { question in
                StarterChip(label: question.label) { ask(question.value) }
            }
        }
        .padding(.top, 4)
    }
}

/// Parts the app can't show yet, with a way to see them on the web.
private struct WebOnlyNotice: View {
    let count: Int
    let webURL: URL?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "rectangle.on.rectangle")
                .foregroundStyle(Palette.mutedForeground)
            Text(
                count == 1
                    ? String(localized: "Part of this answer shows only on the web for now.")
                    : String(localized: "\(count) parts of this answer show only on the web for now.")
            )
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
            Spacer(minLength: 0)
            if let webURL {
                Link("Open", destination: webURL)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.primaryInk)
            }
        }
        .padding(12)
        .background(Palette.fill, in: .rect(cornerRadius: 14))
    }
}
