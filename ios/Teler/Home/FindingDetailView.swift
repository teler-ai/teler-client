import SwiftUI
import TelerFeatures
import TelerKit

/// One Agent finding from Needs you: what the Agent found, the rule that
/// asked for it and its one-line findings. Seen takes it off Needs you; Ask
/// Teler why starts a chat about it.
struct FindingDetailView: View {
    let app: AppModel
    let finding: AgentFinding
    let model: NeedsYouModel
    let open: (Route) -> Void
    @State private var problem: Problem?
    @State private var isMarking = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    IconTile(systemImage: finding.isAlert ? "bell.badge" : "flag")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(finding.agentLabel).font(.subheadline.weight(.semibold))
                        Text(when).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                    }
                }
                Text(finding.title)
                    .font(.title2.weight(.bold))
                if let metric = finding.metric {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.format(metric.value, percent: metric.isPercent))
                            .font(.largeTitle.weight(.semibold))
                            .monospacedDigit()
                        Text(metricCaption(metric))
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                if !finding.items.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(finding.items.enumerated()), id: \.offset) { index, item in
                            if index > 0 { Divider() }
                            Text(item)
                                .font(.subheadline)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, 14)
                    .background(Palette.card, in: .rect(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
                    if finding.findings > finding.items.count {
                        Text("\(finding.findings - finding.items.count) more on the web")
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                if let rule = finding.rule {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "text.quote").foregroundStyle(Palette.mutedForeground)
                        Text("The Agent’s rule: “\(rule)”")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.fill, in: .rect(cornerRadius: 14))
                }
                Button {
                    open(.ask(askWhy))
                } label: {
                    Label("Ask Teler why", systemImage: "sparkles")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.primaryInk)
                        .frame(minHeight: 44)
                }
                if let problem {
                    Label(problem.message, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Palette.warningInk)
                }
            }
            .foregroundStyle(Palette.foreground)
            .padding()
        }
        .background(Palette.background)
        .navigationTitle("Needs you")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                if finding.isWaiting, !app.isSample {
                    Button {
                        Task { await markSeen() }
                    } label: {
                        Text("Seen").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glass)
                    .disabled(isMarking || !app.connectivity.isOnline)
                }
                if let review = reviewURL {
                    Link(destination: review) {
                        Text("Review on the web").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.glassProminent)
                }
            }
            .font(.body.weight(.semibold))
            .padding()
        }
    }

    private var when: String {
        let time = ChatTime.label(finding.at) ?? ""
        if finding.isResolved { return String(localized: "Closed on its own · \(time)") }
        if finding.repeatCount > 0 {
            return String(localized: "\(time) · still happening, \(finding.repeatCount + 1) runs in a row")
        }
        return time
    }

    private func metricCaption(_ metric: AgentMetric) -> String {
        guard let threshold = finding.threshold else { return metric.label }
        return String(localized: "\(metric.label) · the rule's threshold is \(Self.format(threshold, percent: metric.isPercent))")
    }

    private var askWhy: String {
        String(localized: "Why did \(finding.agentLabel) alert me: “\(finding.title)”?")
    }

    /// The alert on Home on the web; a flag opens Home.
    private var reviewURL: URL? {
        if case .alert(let alert) = finding.source {
            return app.accountWebURL(path: "/home", query: [URLQueryItem(name: "alert", value: alert)])
        }
        return app.accountWebURL(path: "/home")
    }

    private func markSeen() async {
        isMarking = true
        defer { isMarking = false }
        do {
            try await model.markSeen(finding)
            dismiss()
        } catch {
            problem = Problem(error)
        }
    }

    /// A percent value is in percentage points: 6.2 reads "6.2%".
    static func format(_ value: Double, percent: Bool) -> String {
        percent
            ? (value / 100).formatted(.percent.precision(.fractionLength(0...1)))
            : value.formatted(.number.precision(.fractionLength(0...2)))
    }
}
