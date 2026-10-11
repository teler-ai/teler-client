import SwiftUI
import TelerFeatures
import TelerKit

/// One dashboard, read-only: its widgets in reading order, each drawn from its
/// own data. Editing and refreshing stay on the web.
struct DashboardView: View {
    let app: AppModel
    let open: (Route) -> Void
    @State private var model: DashboardModel

    init(app: AppModel, workspace: Workspace, dashboard: DashboardID, open: @escaping (Route) -> Void) {
        self.app = app
        self.open = open
        _model = State(initialValue: DashboardModel(id: dashboard, client: workspace.client))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch model.phase {
                case .loading:
                    Text("Loading…")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 20).fill(Palette.card).frame(height: 140)
                    }
                case .failed(let problem):
                    ProblemRow(problem: problem) { Task { await model.load() } }
                case .loaded:
                    if let refreshed = model.detail?.lastRefreshedAt {
                        Text("Updated \(refreshed.formatted(.relative(presentation: .named)))")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    if model.refreshFailed {
                        Banner(
                            systemImage: "exclamationmark.triangle",
                            text: String(localized: "Some widgets couldn't refresh. They show their last good data."))
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        HStack(alignment: .top, spacing: 10) {
                            ForEach(row) { widget in
                                WidgetView(
                                    widget: widget, state: model.widgets[widget.id], webURL: webURL
                                ) {
                                    Task { await model.retry(widget: widget.id) }
                                }
                            }
                        }
                    }
                    Label("Edit widgets and layout on the web.", systemImage: "desktopcomputer")
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .padding(.top, 4)
                }
            }
            .padding(16)
        }
        .background(Palette.background)
        .navigationTitle(model.detail?.name ?? "")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if let webURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: webURL) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Link(destination: webURL) { Label("Open on the web", systemImage: "safari") }
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                }
            }
        }
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    private var webURL: URL? {
        app.isDemo ? nil : app.webURL(path: "/dashboards/\(model.id.rawValue)")
    }

    /// Small metric tiles pair up side by side; everything else takes a row.
    private var rows: [[DashboardWidget]] {
        var rows: [[DashboardWidget]] = []
        for widget in model.orderedWidgets {
            let half = widget.position.w <= 2 && widget.artifact.type == "metric"
            if half, let last = rows.last, last.count == 1, last[0].position.w <= 2,
                last[0].artifact.type == "metric"
            {
                rows[rows.count - 1].append(widget)
            } else {
                rows.append([widget])
            }
        }
        return rows
    }
}

/// One widget: a metric tile, a grid of them, or a chart or table card.
private struct WidgetView: View {
    let widget: DashboardWidget
    let state: DashboardModel.WidgetState?
    let webURL: URL?
    let retry: () -> Void

    var body: some View {
        switch state {
        case .loaded(let spec) where spec.type == "metric":
            KPITile(
                title: spec.title ?? widget.artifact.title ?? "", value: spec.data["value"]?.display ?? "",
                delta: spec.data["delta"]?.display, trend: Trend(spec.data["trend"]?.stringValue))
        case .loaded(let spec) where spec.type == "metric_grid":
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(Array((spec.data["metrics"]?.arrayValue ?? []).enumerated()), id: \.offset) { _, metric in
                    KPITile(
                        title: metric["title"]?.stringValue ?? "", value: metric["value"]?.display ?? "",
                        delta: metric["delta"]?.display, trend: Trend(metric["trend"]?.stringValue))
                }
            }
        case .loaded(let spec):
            card {
                ChartBody(spec: spec, webURL: webURL)
                if let reason = widget.refreshError {
                    Label(Self.message(reason), systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Palette.warningInk)
                }
            }
        case .failed(let problem):
            card {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.warningInk)
                    Text(widget.refreshError.map(Self.message) ?? problem.message)
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                    Button("Retry", systemImage: "arrow.clockwise", action: retry)
                        .buttonStyle(.glass)
                        .font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity)
            }
        case .loading, nil:
            card {
                RoundedRectangle(cornerRadius: 12).fill(Palette.fill).frame(height: 160)
            }
            .accessibilityLabel("Loading \(widget.artifact.title ?? "")")
        }
    }

    private func card(@ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.foreground)
                if let detail = description {
                    Text(detail).font(.footnote).foregroundStyle(Palette.mutedForeground)
                }
            }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
    }

    private var title: String {
        if case .loaded(let spec) = state, let title = spec.title { return title }
        return widget.artifact.title ?? ""
    }

    private var description: String? {
        if case .loaded(let spec) = state { return spec.description }
        return widget.artifact.description
    }

    /// Plain words for why a widget's last refresh failed.
    static func message(_ reason: String) -> String {
        switch reason {
        case "data_source_unavailable":
            String(localized: "Couldn't reach the data source. The connector may be paused, or the network blocked.")
        case "no_credits":
            String(localized: "Refreshes are paused: the organization is out of AI credits.")
        case "approval_required":
            String(localized: "Scheduled refreshes need the owner's approval on the web.")
        default:
            String(localized: "The last refresh didn't finish. This shows the last good data.")
        }
    }
}
