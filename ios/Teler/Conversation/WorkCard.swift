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
    /// Steps a changed plan dropped.
    var replaced: [AnswerLayout.Step] = []
    /// When the dropped stream reconnects; nil while connected.
    var reconnectAt: Date?
    /// When the answer last changed, to say how old its progress is.
    var lastEventAt: Date?
    var retry: (() -> Void)?
    @State private var isOpen = false
    @State private var showsEarlierPlan = false

    /// After this long Teler says so, honestly.
    static var longRunning: TimeInterval { DebugRoute.longRunning }

    var body: some View {
        if isStreaming && !isWriting || isStopped {
            VStack(alignment: .leading, spacing: 8) {
                card
                note
            }
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
            header
            StepBar(steps: steps, isStopped: isStopped)
            if !replaced.isEmpty { earlierPlan }
            StepList(
                steps: steps, isStreaming: isStreaming, isStopped: isStopped, progress: progress,
                lastSeen: reconnectAt == nil ? nil : lastEventAt)
        }
        .padding(14)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var header: some View {
        HStack(spacing: 8) {
            if isStopped {
                Image(systemName: "stop.circle")
                    .foregroundStyle(Palette.mutedForeground)
                Text("Analysis stopped")
                Spacer()
                Elapsed(from: startedAt, to: finishedAt)
            } else if let reconnectAt {
                Image(systemName: "wifi.slash")
                    .foregroundStyle(Palette.mutedForeground)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = max(0, Int(reconnectAt.timeIntervalSince(context.date).rounded(.up)))
                    Text(seconds > 0 ? "Reconnecting in \(seconds) s" : "Reconnecting…")
                }
                Spacer()
                if let retry {
                    Button("Retry now", action: retry)
                        .foregroundStyle(Palette.primaryInk)
                        .frame(minHeight: 44)
                }
            } else {
                WorkingMark()
                TimelineView(.periodic(from: .now, by: 5)) { context in
                    Text(title(at: context.date))
                }
                Spacer()
                Elapsed(from: startedAt, to: nil)
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Palette.foreground)
    }

    private func title(at date: Date) -> LocalizedStringKey {
        if isOffline { return "Waiting for the network" }
        if let startedAt, date.timeIntervalSince(startedAt) > Self.longRunning { return "Taking longer than usual" }
        return "Weaving analysis"
    }

    /// Below a running card: what happens when the stream is down or the work is slow.
    @ViewBuilder private var note: some View {
        if !isStopped {
            if reconnectAt != nil {
                noteLabel("The analysis keeps running on Teler while the app reconnects.")
            } else if let startedAt {
                TimelineView(.periodic(from: .now, by: 5)) { context in
                    if context.date.timeIntervalSince(startedAt) > Self.longRunning {
                        noteLabel("You can leave this chat. Teler keeps working, and the answer is here when you come back.")
                    }
                }
            }
        }
    }

    private func noteLabel(_ text: LocalizedStringKey) -> some View {
        Label(text, systemImage: "info.circle")
            .font(.footnote)
            .foregroundStyle(Palette.mutedForeground)
            .padding(.horizontal, 4)
    }

    /// "Plan changed": the steps the earlier plan had, tucked away, not lost.
    private var earlierPlan: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { showsEarlierPlan.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                    Text(showsEarlierPlan ? "Plan changed · hide the earlier plan" : "Plan changed · show the earlier plan")
                    Spacer()
                    Image(systemName: showsEarlierPlan ? "chevron.up" : "chevron.down").font(.caption.weight(.semibold))
                }
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
                .frame(minHeight: 32)
            }
            .buttonStyle(.plain)
            if showsEarlierPlan {
                ForEach(replaced) { step in
                    HStack(spacing: 8) {
                        Image(systemName: "minus.circle").foregroundStyle(Palette.tertiary)
                        Text(step.label ?? StepNames.label(kind: step.kind))
                            .strikethrough(color: Palette.tertiary)
                            .foregroundStyle(Palette.mutedForeground)
                        Spacer()
                        Text("Replaced").foregroundStyle(Palette.tertiary)
                    }
                    .font(.footnote)
                    .accessibilityElement(children: .combine)
                }
            }
        }
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
