import SwiftUI
import TelerKit

/// Renders one part Teler's app understands natively.
struct ContentFieldView: View {
    let field: ContentField

    var body: some View {
        switch field {
        case .text(let text):
            MarkdownText(text)
        case .report(let title, let markdown):
            VStack(alignment: .leading, spacing: 8) {
                if !title.isEmpty {
                    Text(title).font(.headline)
                }
                MarkdownText(markdown)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
        case .reasoning(let text):
            DisclosureGroup("How Teler approached this") {
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.subheadline)
        case .error:
            Label("This step didn't finish.", systemImage: "exclamationmark.triangle")
                .font(.subheadline)
                .foregroundStyle(Palette.warningInk)
        case .investigationPlan(let plan):
            PlanView(plan: plan)
        case .unknown:
            EmptyView()
        }
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
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    static func attributed(_ source: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
    }
}

struct PlanView: View {
    let plan: InvestigationPlan

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(plan.steps) { step in
                Label {
                    Text(step.label)
                        .foregroundStyle(
                            step.status == .pending ? HierarchicalShapeStyle.secondary : .primary)
                } icon: {
                    StepIcon(status: step.status)
                }
                .font(.subheadline)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.fill, in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

private struct StepIcon: View {
    let status: InvestigationPlan.Status

    var body: some View {
        switch status {
        case .completed:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.success)
        case .inProgress:
            ProgressView().controlSize(.mini)
        case .failed, .blocked:
            Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.warningInk)
        case .skipped, .superseded:
            Image(systemName: "minus.circle").foregroundStyle(.secondary)
        case .pending, .unknown:
            Image(systemName: "circle").foregroundStyle(.tertiary)
        }
    }
}
