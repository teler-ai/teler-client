import SwiftUI
import TelerFeatures
import TelerKit

/// Teler's questions, one at a time, at the end of the conversation: pick an
/// option (the first is Teler's recommendation), go back, take Teler's picks,
/// or type an answer in the composer. A question that arrives while the chat is
/// open sends Teler's picks after 30 seconds untouched, as on the web.
struct QuestionCard: View {
    let model: ConversationModel
    let flow: QuestionFlow
    @State private var secondsLeft: Int?

    var body: some View {
        let question = flow.question
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                TelerMark().frame(width: 18, height: 16)
                Text("Teler needs your answer")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if flow.call.questions.count > 1 {
                    Text("\(flow.counts.current) of \(flow.counts.total)")
                        .font(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(question.question)
                    .font(.headline)
                if let context = question.context {
                    Text(context)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            VStack(spacing: 8) {
                ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                    optionButton(option, recommended: index == 0) {
                        Task { await model.pick(index) }
                    }
                    if index == 0 {
                        Text("Why \(option.label): \(question.why)")
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            footer
        }
        .foregroundStyle(Palette.foreground)
        .padding(14)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.primary.opacity(0.6), lineWidth: 1.5))
        .disabled(model.answerSending == .sending)
        .task(id: flow.call.toolCallID) { await countDown() }
        .accessibilityElement(children: .contain)
    }

    private func optionButton(_ option: AskUserQuestion.Option, recommended: Bool, action: @escaping () -> Void)
        -> some View
    {
        let chosen = flow.answers[flow.step]?.answer == option.label
        return Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(option.label).font(.body.weight(.semibold))
                    Spacer(minLength: 8)
                    if recommended {
                        Text("Recommended")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Palette.primaryInk)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Palette.primary.opacity(0.16), in: .capsule)
                    }
                }
                if !option.description.isEmpty {
                    Text(option.description)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(chosen ? Palette.fillStrong : Palette.fill, in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityHint(recommended ? Text("Teler's recommendation") : Text(""))
    }

    @ViewBuilder private var footer: some View {
        switch model.answerSending {
        case .sending:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Sending…").font(.footnote).foregroundStyle(Palette.mutedForeground)
            }
        case .failed:
            HStack(spacing: 8) {
                Label("Not sent", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Palette.warningInk)
                Spacer()
                Button("Retry", systemImage: "arrow.clockwise") { Task { await model.retryAnswers() } }
                    .buttonStyle(.glass)
                    .font(.subheadline.weight(.semibold))
            }
        case nil:
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    if flow.step > 0 {
                        Button("Back", systemImage: "chevron.left") { model.previousQuestion() }
                            .font(.subheadline)
                            .frame(minHeight: 44)
                    }
                    Spacer()
                    Button(flow.step > 0 ? "Teler’s picks for the rest" : "Go with Teler’s picks") {
                        Task { await model.acceptPicks() }
                    }
                    .buttonStyle(.glass)
                    .font(.subheadline.weight(.semibold))
                }
                Text(hint)
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    private var hint: String {
        if flow.countsDown, let secondsLeft {
            return String(localized: "Teler’s picks go in \(secondsLeft) s · or answer below in your own words")
        }
        return String(localized: "Or answer below in your own words.")
    }

    private func countDown() async {
        guard flow.countsDown else { return }
        for remaining in stride(from: QuestionFlow.autoAnswerSeconds, to: 0, by: -1) {
            secondsLeft = remaining
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled, model.questionFlow?.countsDown == true else {
                secondsLeft = nil
                return
            }
        }
        secondsLeft = nil
        await model.autoAnswer()
    }
}

/// Where Teler's questions stand, in the answer that asked them.
struct QuestionRecord: View {
    let call: AskUserCall
    let status: QuestionStatus?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "questionmark.bubble")
                .foregroundStyle(Palette.mutedForeground)
            Text(asked)
                .font(.subheadline.weight(.medium))
            if let statusText {
                Text("· \(statusText)")
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .foregroundStyle(Palette.foreground)
        .accessibilityElement(children: .combine)
    }

    private var asked: String {
        call.questions.count == 1
            ? String(localized: "Asked 1 question") : String(localized: "Asked \(call.questions.count) questions")
    }

    private var statusText: String? {
        switch status {
        case .waiting: String(localized: "Waiting for your answer")
        case .answered: String(localized: "Answered")
        case .notAnswered: String(localized: "Not answered")
        case .auto: String(localized: "Used Teler’s picks")
        case nil: nil
        }
    }
}

/// The member's answers to Teler's questions, in place of the text Teler reads.
struct AnswersReceipt: View {
    let answers: QuestionAnswers

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Answered Teler’s questions")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                if answers.source == .auto {
                    Text("No answer in 30 s · Teler’s picks")
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                }
            }
            ForEach(Array(answers.answers.enumerated()), id: \.offset) { _, answer in
                VStack(alignment: .leading, spacing: 2) {
                    Text(answer.question)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(answer.answer)
                            .foregroundStyle(Palette.foreground)
                        if answer.kind == .text {
                            Text("in your words").font(.caption).foregroundStyle(Palette.tertiary)
                        } else if answer.recommended {
                            Text("Teler’s pick").font(.caption).foregroundStyle(Palette.tertiary)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: 320, alignment: .leading)
        .background(Palette.bubble, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.bubbleEdge))
        .accessibilityElement(children: .combine)
    }
}

/// A permission Teler asked for before an action. Deciding happens on the
/// web for now, where the action's details and scope can be reviewed.
struct ApprovalCard: View {
    let request: ApprovalRequest
    let webURL: URL?
    let isLatest: Bool

    var body: some View {
        switch state {
        case .waiting:
            VStack(alignment: .leading, spacing: 10) {
                Label("Waiting for your permission", systemImage: "hand.raised")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    if let subject = request.subject {
                        Text("“\(subject)”").font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    }
                }
                Text("Review it on the web, where you can allow it once, for this chat or always. Teler continues after you decide.")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                if let webURL {
                    Link(destination: webURL) {
                        Label("Review on the web", systemImage: "safari")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.glass)
                }
            }
            .foregroundStyle(Palette.foreground)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        case .allowed:
            note("Permission granted for this action.", systemImage: "checkmark.shield")
        case .denied:
            note("Permission denied for this action.", systemImage: "xmark.shield")
        case .expired:
            note(
                "This request expired without approval. Ask Teler to propose the action again.",
                systemImage: "clock.badge.xmark")
        case .ended:
            note("This response stopped before it could use this permission.", systemImage: "stop.circle")
        }
    }

    private enum State {
        case waiting, allowed, denied, expired, ended
    }

    private var state: State {
        if let approved = request.approved { return approved ? .allowed : .denied }
        if request.consumedAt != nil { return .allowed }
        if let expiresAt = request.expiresAt, expiresAt < Date() { return .expired }
        return isLatest ? .waiting : .ended
    }

    private var title: String {
        switch request.toolName {
        case "webSearch": String(localized: "Teler asks to search the web")
        case "webFetch": String(localized: "Teler asks to open a web page")
        case "exploreData": String(localized: "Teler asks to run this data analysis")
        case "repository_operation": String(localized: "Teler asks to change a repository")
        default: String(localized: "Allow this exact action?")
        }
    }

    private func note(_ text: LocalizedStringKey, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
    }
}
