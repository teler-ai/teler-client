import Foundation
import Observation
import TelerKit

/// The organization's dashboards, searchable by name.
@MainActor @Observable
public final class DashboardListModel {
    public enum Phase: Equatable {
        case loading
        case loaded
        case failed(Problem)
    }

    private let workspace: Workspace
    public private(set) var dashboards: [DashboardSummary] = []
    public private(set) var phase = Phase.loading
    public private(set) var hasMore = false
    private var nextCursor: String?
    private var text: String?

    public init(workspace: Workspace) {
        self.workspace = workspace
    }

    /// The first page, or the dashboards whose name matches `text`.
    public func load(matching text: String? = nil) async {
        let text = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.text = text?.isEmpty == false ? text : nil
        do {
            guard let organization = try await workspace.activeOrganization() else {
                phase = .failed(.noOrganization)
                return
            }
            let page = try await workspace.client.dashboards(in: organization, matching: self.text)
            dashboards = page.dashboards
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            phase = .loaded
        } catch is CancellationError {
            return
        } catch {
            if dashboards.isEmpty { phase = .failed(Problem(error)) }
        }
    }

    public func loadMore() async {
        guard hasMore, let cursor = nextCursor else { return }
        nextCursor = nil
        do {
            guard let organization = try await workspace.activeOrganization() else { return }
            let page = try await workspace.client.dashboards(in: organization, matching: text, cursor: cursor)
            let known = Set(dashboards.map(\.id))
            dashboards += page.dashboards.filter { !known.contains($0.id) }
            hasMore = page.hasMore
            nextCursor = page.nextCursor
        } catch {
            nextCursor = cursor
        }
    }
}

/// One dashboard: its widgets in reading order, each with its own data.
@MainActor @Observable
public final class DashboardModel {
    public enum Phase: Equatable {
        case loading
        case loaded
        case failed(Problem)
    }

    public enum WidgetState: Equatable, Sendable {
        case loading
        case loaded(ChartSpec)
        case failed(Problem)
    }

    public let id: DashboardID
    private let client: TelerAPIClient
    public private(set) var phase = Phase.loading
    public private(set) var detail: DashboardDetail?
    public private(set) var widgets: [String: WidgetState] = [:]

    public init(id: DashboardID, client: TelerAPIClient) {
        self.id = id
        self.client = client
    }

    /// Widgets top to bottom, then left to right, as the web lays them out.
    public var orderedWidgets: [DashboardWidget] {
        (detail?.widgets ?? []).sorted {
            ($0.position.y, $0.position.x, $0.sortOrder ?? 0) < ($1.position.y, $1.position.x, $1.sortOrder ?? 0)
        }
    }

    /// The last refresh failed for some or all widgets; the data shown is older.
    public var refreshFailed: Bool {
        ["failed", "partial"].contains(detail?.refresh?.status ?? "")
    }

    /// Reads the dashboard and every widget's data. It never refreshes the
    /// data on the server, which runs queries on the organization's credits.
    public func load() async {
        do {
            let detail = try await client.dashboard(id)
            self.detail = detail
            phase = .loaded
            await loadWidgets(detail.widgets.map(\.id))
        } catch is CancellationError {
            return
        } catch {
            if detail == nil { phase = .failed(Problem(error)) }
        }
    }

    public func retry(widget: String) async {
        await loadWidgets([widget])
    }

    private func loadWidgets(_ ids: [String]) async {
        for id in ids where widgets[id] == nil || widgets[id] != .loading {
            if case .loaded = widgets[id] { continue }
            widgets[id] = .loading
        }
        await withTaskGroup(of: (String, WidgetState).self) { group in
            for widget in ids {
                group.addTask { [client, id] in
                    do {
                        return (widget, .loaded(try await client.widgetSpec(dashboard: id, widget: widget)))
                    } catch {
                        return (widget, .failed(Problem(error)))
                    }
                }
            }
            for await (widget, state) in group {
                if case .failed = state, case .loaded = widgets[widget] { continue }
                widgets[widget] = state
            }
        }
    }
}
