import SwiftUI
import TelerFeatures
import TelerKit

/// The steps Teler works through for an answer, in plain words. While it
/// works the card shows every step and what each found; once the answer is
/// being written it condenses to one live line; when done it folds into a
/// receipt at the top of the answer that opens the steps again.
struct WorkCard: View {
    let steps: [AnswerLayout.Step]
    let isStreaming: Bool
    let isWriting: Bool
    /// The turn ended without finishing, such as stopped or too long.
    let isStopped: Bool
    let startedAt: Date?
    let finishedAt: Date?
    var progress: TaskProgress?
    var isOffline = false
    @State private var isOpen = false

    var body: some View {
        if isStreaming && !isWriting || isStopped {
            card
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    withAnimation(.snappy) { isOpen.toggle() }
                } label: {
                    if isStreaming { liveLine } else { receipt }
                }
                .buttonStyle(.plain)
                if isOpen {
                    StepList(steps: steps, isStreaming: isStreaming, isStopped: false, progress: progress)
                        .transition(.opacity)
                }
            }
            .padding(isOpen ? 14 : 0)
            .background(isOpen ? Palette.card : .clear, in: .rect(cornerRadius: 20))
            .overlay {
                if isOpen { RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border) }
            }
        }
    }

    /// Every step while Teler works, or how far it got when it stopped.
    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if isStopped {
                    Image(systemName: "stop.circle")
                        .foregroundStyle(Palette.mutedForeground)
                    Text("Analysis stopped")
                } else {
                    WorkingMark()
                    Text(isOffline ? "Waiting for the network" : "Weaving analysis")
                }
                Spacer()
                Elapsed(from: startedAt, to: isStopped ? finishedAt : nil)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.foreground)
            StepBar(steps: steps, isStopped: isStopped)
            StepList(steps: steps, isStreaming: isStreaming, isStopped: isStopped, progress: progress)
        }
        .padding(14)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        .accessibilityElement(children: .contain)
    }

    /// One line while the answer is written.
    private var liveLine: some View {
        HStack(spacing: 8) {
            WorkingMark()
            Text("Writing the answer")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.foreground)
            Spacer()
            StepBar(steps: steps, isStopped: false)
                .frame(width: 44)
            Elapsed(from: startedAt, to: nil)
            Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.tertiary)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(isOpen ? .clear : Palette.card, in: .capsule)
        .overlay { if !isOpen { Capsule().strokeBorder(Palette.border) } }
    }

    /// "Worked for 48 s · 3 steps", which opens the steps.
    private var receipt: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(Palette.mutedForeground)
            Text(receiptText)
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
            Spacer()
            Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.tertiary)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(isOpen ? .clear : Palette.fill, in: .capsule)
        .accessibilityHint(isOpen ? "Hides the steps" : "Shows the steps")
    }

    private var receiptText: String {
        let count = steps.count
        let stepsText =
            count == 1 ? String(localized: "1 step") : String(localized: "\(count) steps")
        guard let startedAt, let finishedAt, finishedAt > startedAt else { return stepsText }
        let duration = Elapsed.format(finishedAt.timeIntervalSince(startedAt))
        return String(localized: "Worked for \(duration) · \(stepsText)")
    }
}

/// The steps as a timeline: done, under way, not yet, or cut short.
private struct StepList: View {
    let steps: [AnswerLayout.Step]
    let isStreaming: Bool
    let isStopped: Bool
    let progress: TaskProgress?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 0) {
                        icon(step)
                            .frame(width: 20, height: 22)
                        if index < steps.count - 1 {
                            Rectangle()
                                .fill(Palette.border)
                                .frame(width: 1.5)
                                .frame(maxHeight: .infinity)
                        }
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(title(step))
                                .font(.callout.weight(state(step) == .pending ? .regular : .medium))
                                .foregroundStyle(
                                    state(step) == .pending ? Palette.mutedForeground : Palette.foreground)
                            Spacer(minLength: 8)
                            if let word = statusWord(step) {
                                Text(word)
                                    .font(.footnote)
                                    .foregroundStyle(Palette.mutedForeground)
                            } else if let seconds = step.seconds, state(step) != .pending {
                                Text(Elapsed.format(TimeInterval(seconds)))
                                    .font(.footnote)
                                    .monospacedDigit()
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        }
                        ForEach(step.findings, id: \.self) { finding in
                            Text(finding)
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        if state(step) == .running, let progress, progress.total > 0 {
                            HStack(spacing: 8) {
                                ProgressView(value: Double(min(progress.current, progress.total)), total: Double(progress.total))
                                    .tint(Palette.primaryInk)
                                    .frame(width: 70)
                                Text(progress.message.isEmpty ? "\(progress.current) of \(progress.total)" : progress.message)
                                    .font(.footnote)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            .padding(.top, 2)
                        }
                    }
                    .padding(.bottom, index < steps.count - 1 ? 12 : 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(Text(statusWord(step) ?? accessibilityState(step)))
            }
        }
    }

    private enum State {
        case done, running, pending, limited, failed
    }

    private func state(_ step: AnswerLayout.Step) -> State {
        switch step.status {
        case .completed: return .done
        case .inProgress: return isStopped ? .limited : (isStreaming ? .running : .done)
        case .failed, .blocked: return .failed
        case .skipped, .superseded: return .limited
        case .pending, .unknown: return .pending
        }
    }

    /// Words only for exceptions; done and running speak for themselves.
    private func statusWord(_ step: AnswerLayout.Step) -> String? {
        switch state(step) {
        case .limited: String(localized: "Limited")
        case .failed: String(localized: "Not confirmed")
        case .pending where isStopped: String(localized: "Not started")
        default: nil
        }
    }

    private func accessibilityState(_ step: AnswerLayout.Step) -> String {
        switch state(step) {
        case .done: String(localized: "Done")
        case .running: String(localized: "In progress")
        default: String(localized: "Not started")
        }
    }

    @ViewBuilder private func icon(_ step: AnswerLayout.Step) -> some View {
        switch state(step) {
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.primaryInk)
        case .running:
            Image(systemName: "circle.inset.filled").foregroundStyle(Palette.primaryInk)
                .symbolEffect(.pulse)
        case .pending:
            Image(systemName: "circle").foregroundStyle(Palette.tertiary)
        case .limited:
            Image(systemName: "minus.circle").foregroundStyle(Palette.mutedForeground)
        case .failed:
            Image(systemName: "exclamationmark.circle").foregroundStyle(Palette.warningInk)
        }
    }

    private func title(_ step: AnswerLayout.Step) -> String {
        if let label = step.label, !label.isEmpty { return label }
        return StepNames.label(kind: step.kind)
    }
}

/// Names for work Teler did without a plan, by its kind.
enum StepNames {
    static func label(kind: String?) -> String {
        switch kind {
        case "checking-available-data": String(localized: "Check the available data")
        case "reviewing-information": String(localized: "Review the information")
        case "searching-information": String(localized: "Search for information")
        case "choosing-approach": String(localized: "Choose an approach")
        case "applying-approach": String(localized: "Apply the approach")
        case "recalling-context": String(localized: "Recall what you shared before")
        case "preparing-answer": String(localized: "Prepare the answer")
        default: String(localized: "Explore the data")
        }
    }
}

/// One segment per step: filled when done, half for the one under way.
private struct StepBar: View {
    let steps: [AnswerLayout.Step]
    let isStopped: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(steps) { step in
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.fillStrong)
                        Capsule().fill(isStopped ? Palette.mutedForeground : Palette.primaryInk)
                            .frame(width: geometry.size.width * fill(step))
                    }
                }
                .frame(height: 3)
            }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }

    private func fill(_ step: AnswerLayout.Step) -> CGFloat {
        switch step.status {
        case .completed: 1
        case .inProgress: 0.5
        default: 0
        }
    }
}

/// Teler's mark, breathing while it works.
private struct WorkingMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TelerMark()
            .frame(width: 18, height: 16)
            .phaseAnimator(reduceMotion ? [1.0] : [1.0, 0.45]) { mark, opacity in
                mark.opacity(opacity)
            } animation: { _ in .easeInOut(duration: 0.9) }
    }
}

/// How long something has run: "40 s", then "1:40", ticking while it's live.
struct Elapsed: View {
    let from: Date?
    let to: Date?

    var body: some View {
        if let from {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(Self.format((to ?? context.date).timeIntervalSince(from)))
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
    }

    static func format(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval.rounded()))
        if seconds < 60 { return String(localized: "\(seconds) s") }
        if seconds < 3600 { return String(format: "%d:%02d", seconds / 60, seconds % 60) }
        return String(localized: "\(seconds / 3600) h \((seconds % 3600) / 60) min")
    }
}
