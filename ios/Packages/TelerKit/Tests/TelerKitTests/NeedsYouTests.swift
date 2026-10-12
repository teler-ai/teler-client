import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// Home's Needs you: Agent findings and access requests, in the web's order.
@MainActor @Suite struct NeedsYouTests {
    private func demo() -> TelerAPIClient {
        TelerAPIClient(
            origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
    }

    private func finding(_ json: String) throws -> AgentFinding {
        try #require(AgentFinding(json: try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))))
    }

    @Test func putsAlertsThenRequestsThenFlags() async throws {
        let model = NeedsYouModel(workspace: Workspace(client: demo()), user: "usr_demo_laia")
        await model.load()
        #expect(model.isLoaded)
        let ids = model.waiting.map(\.id)
        #expect(ids == ["alert:alrt_demo_reorder", "access:areq_demo_wholesale", "flag:arun_demo_refunds"])
        #expect(model.closed.map(\.title) == ["Ethiopia Guji is out of stock in 2 stores"])
        guard case .finding(let alert) = model.waiting[0] else {
            Issue.record("Expected the alert first")
            return
        }
        #expect(alert.metric?.value == 4860)
        #expect(alert.items.count == 3)
    }

    @Test func leavesOutTheMembersOwnRequests() async throws {
        let model = NeedsYouModel(workspace: Workspace(client: demo()), user: "usr_demo_pere")
        await model.load()
        #expect(!model.items.contains { if case .access = $0 { true } else { false } })
    }

    @Test func marksFindingsSeenAndAnswersRequests() async throws {
        let client = demo()
        let model = NeedsYouModel(workspace: Workspace(client: client), user: nil)
        await model.load()
        guard case .finding(let alert) = model.items[0], case .access(let request) = model.items[1] else {
            Issue.record("Unexpected order")
            return
        }
        try await model.markSeen(alert)
        let items = try await model.review(request)
        #expect(items.map(\.name) == ["wholesale_orders", "wholesale_customers"])
        try await model.decide(request, .give([items[0].id]))
        #expect(model.items.count == 1)

        let again = NeedsYouModel(workspace: Workspace(client: client), user: nil)
        await again.load()
        #expect(again.items.map(\.id) == ["flag:arun_demo_refunds"])
    }

    @Test func limitsWhatHomeShowsAndKeepsRequestsInView() throws {
        let alerts = try (0..<4).map { index in
            try finding(
                #"{"source":"agent_alert","alertId":"a\#(index)","agentLabel":"Watch","title":"T\#(index)","state":"open","seen":false,"lastFlaggedAt":"2026-10-1\#(index)T08:00:00.000Z","findings":1}"#)
        }
        let request = try #require(
            AccessRequest(
                json: try JSONDecoder().decode(
                    JSONValue.self,
                    from: Data(
                        #"{"id":"r1","requester":{"userId":"u2","name":"Pere"},"group":{"kind":"personal_files","owner":{"name":"Laia"},"restrictedCount":1},"status":"pending","createdAt":"2026-10-12T08:00:00.000Z","reason":""}"#
                            .utf8))))
        let (items, _) = NeedsYouModel.arrange(findings: alerts, requests: [request])
        #expect(items.count == 5)
        #expect(Array(items.prefix(3)).map(\.id) == ["alert:a3", "alert:a2", "access:r1"])
    }

    @Test func dropsTheFlagOfAnAlertedRunAndChecksIDs() async throws {
        let flags = try await demo().agentFindings(in: DemoData.organization)
        #expect(flags.count == 3)
        await #expect(throws: TelerAPIError.invalidResponse) {
            try await self.demo().decideAccess("../users", in: DemoData.organization, .decline(nil))
        }
        let seen = try finding(
            #"{"source":"agent_run_flag","runId":"r","agentLabel":"A","title":"T","status":"seen","createdAt":"2026-10-12T08:00:00.000Z","findings":1}"#)
        #expect(!seen.isWaiting)
    }
}
