import SwiftUI
import TelerFeatures
import TelerKit

/// The organization's dashboards, searchable by name.
struct DashboardListView: View {
    let app: AppModel
    let open: (Route) -> Void
    @State private var model: DashboardListModel
    @State private var query = ""

    init(app: AppModel, workspace: Workspace, open: @escaping (Route) -> Void) {
        self.app = app
        self.open = open
        _model = State(initialValue: DashboardListModel(workspace: workspace))
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.background)
            .navigationTitle("Dashboards")
            .searchable(text: $query, prompt: "Search dashboards")
            .task(id: query) {
                if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
                guard !Task.isCancelled else { return }
                await model.load(matching: query)
            }
            .refreshable { await model.load(matching: query) }
            .toolbar { MainToolbar(app: app) }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { _ in
                        DashboardCard(dashboard: Self.placeholder).redacted(reason: .placeholder)
                    }
                }
                .padding(16)
            }
            .accessibilityLabel("Loading")
        case .failed(let problem):
            ContentUnavailableView {
                Label("Dashboards didn't load", systemImage: problem == .offline ? "wifi.slash" : "square.grid.2x2")
            } description: {
                Text(problem.message)
            } actions: {
                Button("Try again") { Task { await model.load(matching: query) } }
                    .buttonStyle(.glass)
            }
        case .loaded where model.dashboards.isEmpty && query.isEmpty:
            ContentUnavailableView {
                Label("No dashboards yet", systemImage: "square.grid.2x2")
            } description: {
                Text("Pin a chart from any chat, or ask Teler to build a dashboard for the numbers you watch.")
            } actions: {
                Button("Ask Teler to build one") { open(.newChat) }
                    .buttonStyle(PrimaryCapsuleStyle())
                    .frame(maxWidth: 260)
            }
        case .loaded where model.dashboards.isEmpty:
            ContentUnavailableView.search(text: query)
        case .loaded:
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(model.dashboards) { dashboard in
                        Button {
                            open(.dashboard(dashboard.id))
                        } label: {
                            DashboardCard(dashboard: dashboard)
                        }
                        .buttonStyle(.plain)
                        .onAppear {
                            if dashboard.id == model.dashboards.last?.id { Task { await model.loadMore() } }
                        }
                    }
                }
                .padding(16)
            }
        }
    }

    private static let placeholder = DashboardSummary(
        id: DashboardID(rawValue: "dash_" + String(repeating: "0", count: 26))!, name: "Dashboard name",
        description: "A description of some length", lastRefreshedAt: .now, widgetCount: 6)
}

/// A dashboard in the list: its name, what it holds and how fresh it is.
private struct DashboardCard: View {
    let dashboard: DashboardSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(dashboard.name)
                    .font(.headline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if let permission = dashboard.permission, permission != "owner" {
                    Text("Shared with me")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.fill, in: .capsule)
                }
            }
            if let description = dashboard.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .lineLimit(2)
            }
            if let previews = dashboard.widgetPreviews, !previews.isEmpty {
                Text(previews.prefix(3).map(\.title).joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(Palette.foreground)
                    .lineLimit(1)
            }
            Text(freshness)
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        .contentShape(.rect(cornerRadius: 20))
    }

    private var freshness: String {
        var parts: [String] = []
        if let refreshed = dashboard.lastRefreshedAt ?? dashboard.updatedAt {
            parts.append(String(localized: "Updated \(refreshed.formatted(.relative(presentation: .named)))"))
        }
        if let count = dashboard.widgetCount {
            parts.append(count == 1 ? String(localized: "1 widget") : String(localized: "\(count) widgets"))
        }
        return parts.joined(separator: " · ")
    }
}
