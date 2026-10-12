import SwiftUI
import TelerFeatures
import TelerKit

/// The steps as a timeline: done, under way, not yet, or cut short.
struct StepList: View {
    let steps: [AnswerLayout.Step]
    let isStreaming: Bool
    let isStopped: Bool
    let progress: TaskProgress?
    /// While reconnecting: when the progress was last seen.
    var lastSeen: Date?

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
                        if state(step) == .running, step.isRetrying {
                            Text("Trying a different approach…")
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                        if state(step) == .running, let progress, progress.total > 0 {
                            HStack(spacing: 8) {
                                ProgressView(value: Double(min(progress.current, progress.total)), total: Double(progress.total))
                                    .tint(Palette.primaryInk)
                                    .frame(width: 70)
                                Text(progressText(progress))
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

    private func progressText(_ progress: TaskProgress) -> String {
        let text = progress.message.isEmpty ? "\(progress.current) of \(progress.total)" : progress.message
        guard let lastSeen else { return text }
        let seconds = max(1, Int(Date().timeIntervalSince(lastSeen)))
        return String(localized: "\(text) · \(seconds) s ago")
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
struct StepBar: View {
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
struct WorkingMark: View {
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

/// Before any step arrived, a dropped stream says when it reconnects.
struct ReconnectingLine: View {
    let at: Date
    let retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash")
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = max(0, Int(at.timeIntervalSince(context.date).rounded(.up)))
                    Text(seconds > 0 ? "Reconnecting in \(seconds) s" : "Reconnecting…")
                }
                Spacer()
                if let retry {
                    Button("Retry now", action: retry)
                        .fontWeight(.semibold)
                        .foregroundStyle(Palette.primaryInk)
                        .frame(minHeight: 44)
                }
            }
            .font(.subheadline)
            .foregroundStyle(Palette.mutedForeground)
            Text("The analysis keeps running on Teler while the app reconnects.")
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        }
    }
}
