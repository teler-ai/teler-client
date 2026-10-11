import Foundation
import Testing

@testable import TelerDemo
@testable import TelerKit

/// Runs the real client, parser and merge rules against the demo API.
@Suite struct DemoTransportTests {
    private func client() -> TelerAPIClient {
        TelerAPIClient(
            origin: DemoData.origin,
            identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
    }

    @Test func listsTheSampleChatsNewestFirst() async throws {
        let page = try await client().chats()
        #expect(page.chats.map(\.title) == [
            "Quarterly revenue by region", "Why did churn rise in September?", "Top products this week",
        ])
        let detail = try await client().chat(page.chats[2].id)
        #expect(detail.messages.last?.content.map(\.type) == ["text", "chart_artifact", "text"])
    }

    @Test func streamsANewTurnAndStoresTheFinishedAnswer() async throws {
        let client = client()
        let organization = try #require(try await client.activeOrganization())
        let chat = try await client.createChat(in: organization)
        let turn = try await client.sendMessage("Which region grew fastest?", to: chat)

        var content: [ContentField] = []
        var last: TaskStreamEvent?
        for try await event in client.taskEvents(chat: chat, task: turn.taskId) {
            content = ContentMerge.append(event.fields, to: content)
            last = event
        }
        #expect(last?.done == true)
        guard case .investigationPlan(let plan) = content.first else {
            Issue.record("Expected the plan first, got \(content)")
            return
        }
        #expect(plan.revision == 4)
        #expect(plan.steps.allSatisfy { $0.status == .completed })
        guard case .text(let answer) = content.last else {
            Issue.record("Expected a text answer")
            return
        }
        #expect(answer.contains("“Which region grew fastest?”"))
        #expect(!answer.contains("  "))

        let detail = try await client.chat(chat)
        #expect(detail.title == "Which region grew fastest?")
        #expect(detail.activeAgentTask == nil)
        let stored = try #require(detail.messages.last)
        #expect(stored.id == turn.messageId)
        #expect(ContentMerge.latestPlans(stored.content) == content)
    }
}
