import LocalAuthentication
import SwiftUI
import TelerFeatures
import TelerKit

/// A row in Home's Needs you: an Agent finding to review, or an access
/// request to answer right there.
struct NeedsYouRow: View {
    let item: NeedsYouModel.Item
    let model: NeedsYouModel
    let isOnline: Bool
    let open: (Route) -> Void
    @State private var reviewing: AccessRequest?
    @State private var declining: AccessRequest?
    @State private var failed = false

    var body: some View {
        switch item {
        case .finding(let finding):
            Button {
                open(.finding(finding))
            } label: {
                HStack(spacing: 12) {
                    IconTile(systemImage: finding.isAlert ? "bell.badge" : "flag")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(finding.title)
                            .font(.body.weight(.medium))
                            .foregroundStyle(Palette.foreground)
                            .multilineTextAlignment(.leading)
                        Text(finding.byline)
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.tertiary)
                }
                .padding(.vertical, 4)
            }
        case .access(let request):
            HStack(alignment: .top, spacing: 12) {
                Avatar(initials: request.requesterInitials, style: .alternate, size: 30)
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(request.title)
                            .font(.body.weight(.medium))
                            .foregroundStyle(Palette.foreground)
                        Text("Access request · \(ChatTime.label(request.createdAt) ?? "")")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                        if !request.reason.isEmpty {
                            Text("“\(request.reason)”")
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                        }
                    }
                    HStack(spacing: 8) {
                        Button("Give access") { reviewing = request }
                            .buttonStyle(.glassProminent)
                        Button("Decline…") { declining = request }
                            .buttonStyle(.glass)
                    }
                    .font(.subheadline.weight(.semibold))
                    .disabled(!isOnline)
                    if !isOnline {
                        Text("You can answer when you're back online.")
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    if failed {
                        Label("That didn't go through. Try again.", systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(Palette.warningInk)
                    }
                }
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            }
            .padding(.vertical, 6)
            .sheet(item: $reviewing) { request in
                AccessReviewSheet(request: request, model: model)
            }
            .confirmationDialog(
                "Decline \(request.requesterName ?? String(localized: "this request"))’s request?",
                isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } }),
                titleVisibility: .visible
            ) {
                ForEach(AccessDecision.DeclineReason.allCases, id: \.self) { reason in
                    Button(reason.label) { decline(request, reason) }
                }
                Button("Decline without a reason") { decline(request, nil) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Only these reasons, so nothing you write can name data they can't see.")
            }
        }
    }

    private func decline(_ request: AccessRequest, _ reason: AccessDecision.DeclineReason?) {
        Task {
            do {
                try await model.decide(request, .decline(reason))
            } catch {
                failed = true
            }
        }
    }
}

/// An alert that closed on its own, until it leaves Home.
struct ClosedAlertRow: View {
    let finding: AgentFinding
    let open: (Route) -> Void

    var body: some View {
        Button {
            open(.finding(finding))
        } label: {
            HStack(spacing: 12) {
                IconTile(systemImage: "checkmark.circle")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Back to normal · \(finding.agentLabel)")
                        .foregroundStyle(Palette.foreground)
                    Text(finding.title)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .lineLimit(1)
                }
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            }
            .padding(.vertical, 2)
        }
    }
}

/// Choosing which tables or files to give read access to. Teler can't tell
/// which ones the requester needs, so none starts chosen, as on the web.
/// Giving access asks for Face ID or the passcode first.
struct AccessReviewSheet: View {
    let request: AccessRequest
    let model: NeedsYouModel
    @State private var items: [AccessReviewItem]?
    @State private var chosen = Set<String>()
    @State private var problem: Problem?
    @State private var isGiving = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(request.title).font(.headline)
                    if !request.reason.isEmpty {
                        Text("“\(request.reason)”").foregroundStyle(Palette.mutedForeground)
                    }
                }
                if let items {
                    Section {
                        ForEach(items) { item in
                            Button {
                                if chosen.contains(item.id) { chosen.remove(item.id) } else { chosen.insert(item.id) }
                            } label: {
                                HStack {
                                    Image(systemName: chosen.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(chosen.contains(item.id) ? Palette.primaryInk : Palette.tertiary)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.name).foregroundStyle(Palette.foreground)
                                        if let rows = item.rowCount {
                                            Text("\(rows.formatted()) rows")
                                                .font(.subheadline)
                                                .foregroundStyle(Palette.mutedForeground)
                                        }
                                    }
                                }
                            }
                            .accessibilityAddTraits(chosen.contains(item.id) ? .isSelected : [])
                        }
                    } header: {
                        Text("Give read access to")
                    } footer: {
                        Text(
                            "Teler can't tell which of these \(request.requesterName ?? String(localized: "they")) needs. Choose at least one. Read access lasts until someone revokes it in Data on the web."
                        )
                    }
                } else if problem == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }
                if let problem {
                    Label(problem.message, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Palette.warningInk)
                }
            }
            .navigationTitle("Give access")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await give() }
                } label: {
                    Text(giveLabel)
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glassProminent)
                .disabled(chosen.isEmpty || isGiving)
                .padding()
            }
            .task { await load() }
        }
        .presentationDetents([.large])
    }

    private var giveLabel: String {
        let tables = items?.filter { chosen.contains($0.id) }.allSatisfy(\.isTable) ?? true
        switch (chosen.count, tables) {
        case (0, _): return String(localized: "Give access")
        case (1, true): return String(localized: "Give access to 1 table")
        case (let count, true): return String(localized: "Give access to \(count) tables")
        case (1, false): return String(localized: "Give access to 1 file")
        case (let count, false): return String(localized: "Give access to \(count) files")
        }
    }

    private func load() async {
        do {
            items = try await model.review(request)
        } catch {
            problem = Problem(error)
        }
    }

    private func give() async {
        guard await Self.confirmIdentity() else { return }
        isGiving = true
        defer { isGiving = false }
        do {
            try await model.decide(request, .give(Array(chosen)))
            dismiss()
        } catch {
            problem = Problem(error)
        }
    }

    /// Face ID, Touch ID or the passcode; a device without any passes.
    private static func confirmIdentity() async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return true }
        return (try? await context.evaluatePolicy(
            .deviceOwnerAuthentication, localizedReason: String(localized: "Give read access to this data"))) ?? false
    }
}

extension AgentFinding {
    var isAlert: Bool {
        if case .alert = source { true } else { false }
    }

    /// "Wholesale reorder watch · 7:02", naming a colleague's Agent as theirs.
    var byline: String {
        let agent = ownerName.map { String(localized: "\(agentLabel) (\($0)’s)") } ?? agentLabel
        return [agent, ChatTime.label(at)].compactMap { $0 }.joined(separator: " · ")
    }
}

extension AccessRequest {
    var title: String {
        let name = requesterName ?? String(localized: "Someone")
        let group: String =
            switch groupKind {
            case .connector: connectionName ?? String(localized: "a connection")
            case .personalFiles:
                ownerName.map { String(localized: "\($0)’s private files") } ?? String(localized: "private files")
            case .organizationFiles:
                ownerName.map { String(localized: "organization files from \($0)") }
                    ?? String(localized: "organization files")
            }
        return String(localized: "\(name) wants access to \(group)")
    }

    var requesterInitials: String {
        let letters = (requesterName ?? "").split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}

extension AccessDecision.DeclineReason {
    /// The web's words for each reason.
    var label: String {
        switch self {
        case .notNeeded: String(localized: "This data isn’t needed for that")
        case .sensitive: String(localized: "It’s sensitive and stays restricted")
        case .askForSummary: String(localized: "Ask the data owner for a summary instead")
        case .notNow: String(localized: "Not now. Ask again later")
        }
    }
}
