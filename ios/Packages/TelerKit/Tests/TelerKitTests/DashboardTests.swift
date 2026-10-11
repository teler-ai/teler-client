import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// Dashboards are only read: the list, one dashboard and each widget's data.
@MainActor @Suite struct DashboardTests {
    private func demo() -> TelerAPIClient {
        TelerAPIClient(
            origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
    }

    @Test func listsTheOrganizationsDashboards() async {
        let list = DashboardListModel(workspace: Workspace(client: demo()))
        await list.load()
        #expect(list.phase == .loaded)
        #expect(list.dashboards.map(\.name) == ["Executive overview", "Product sales"])
        #expect(list.dashboards.first?.widgetCount == 4)
    }

    @Test func readsADashboardAndEachWidgetsData() async throws {
        let id = try #require(DashboardID(rawValue: DemoData.executiveDashboard))
        let dashboard = DashboardModel(id: id, client: demo())
        await dashboard.load()
        #expect(dashboard.phase == .loaded)
        #expect(dashboard.orderedWidgets.map(\.artifact.type) == ["metric_grid", "line", "bar", "table"])
        guard case .loaded(let headline)? = dashboard.widgets["wgt_headline"] else {
            Issue.record("The headline widget didn't load")
            return
        }
        #expect(headline.data["metrics"]?.arrayValue?.count == 4)
        #expect(!dashboard.refreshFailed)
    }

    @Test func asksForTheOrganizationsDashboardsWithoutRefreshing() async throws {
        let transport = StubTransport([
            .response(status: 200, chunks: [#"{"activeOrganizationId":"org_01jczpznh32py20pd8y10ef9cq"}"#]),
            .response(status: 200, chunks: [#"{"dashboards":[],"items":[],"hasMore":false,"nextCursor":null}"#]),
        ])
        let list = DashboardListModel(workspace: Workspace(client: .stubbed(transport)))
        await list.load(matching: " revenue ")
        #expect(list.phase == .loaded && list.dashboards.isEmpty)
        let request = try #require(transport.requests.last)
        #expect(request.method == .get)
        #expect(request.url.path == "/api/dashboard")
        let query = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(query.first { $0.name == "query" }?.value == "revenue")
        #expect(query.first { $0.name == "organizationId" }?.value == "org_01jczpznh32py20pd8y10ef9cq")
    }

    @Test func keepsOnlyAReasonCodeForAFailedWidget() throws {
        let json = #"""
            {"id":"wgt_1","position":{"x":0,"y":0,"w":2,"h":1},"artifact":{"type":"metric","title":"Revenue"},
             "config":{"refreshState":{"status":"error","error":{"reason":"data_source_unavailable","message":"connection to db-7.internal:5432 refused"}}}}
            """#
        let widget = try JSONDecoder().decode(DashboardWidget.self, from: Data(json.utf8))
        #expect(widget.refreshError == "data_source_unavailable")
    }
}
