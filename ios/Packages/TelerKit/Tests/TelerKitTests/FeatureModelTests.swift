import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// The screens' behavior against the demo API, without any UI.
@MainActor @Suite struct FeatureModelTests {
    private let client = TelerAPIClient(
        origin: DemoData.origin,
        identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
        transport: DemoTransport(chunkDelay: .zero))

    @Test func listsTheOrganizationsChats() async throws {
        let list = ChatListModel(workspace: Workspace(client: client))
        await list.load()
        #expect(list.phase == .loaded)
        #expect(list.chats.count == 3)
    }

    @Test func showsAStoredChatWithOnePlanPerPlanID() async throws {
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let model = ConversationModel(chat: chat, client: client)
        await model.load()
        #expect(model.phase == .ready)
        #expect(model.title == "Quarterly revenue by region")
        #expect(model.items.map(\.role) == [.user, .assistant])
        #expect(
            model.items.last?.content.map(\.type) == [
                "investigation_plan", "analysis_activity", "analysis_activity", "analysis_activity", "text",
                "chart_artifact", "quick_actions",
            ])
    }

    @Test func sendsAQuestionAndShowsTheStreamedAnswer() async throws {
        let organization = try #require(try await client.activeOrganization())
        let chat = try await client.createChat(in: organization)
        let model = ConversationModel(chat: chat, client: client)
        await model.load()
        #expect(!model.canSend)

        model.draft = "  Which region grew fastest?  "
        #expect(model.canSend)
        await model.send()
        #expect(model.draft.isEmpty)
        await model.streamTask?.value

        #expect(model.streamProblem == nil)
        #expect(model.title == "Which region grew fastest?")
        let answer = try #require(model.items.last)
        #expect(answer.role == .assistant)
        #expect(!answer.isStreaming)
        guard case .investigationPlan(let plan) = answer.content.first,
            case .text(let text) = answer.content.last
        else {
            Issue.record("Unexpected answer \(answer.content)")
            return
        }
        #expect(plan.steps.allSatisfy { $0.status == .completed })
        #expect(text.contains("Which region grew fastest?"))
        #expect(model.canSend == false)
        model.draft = "Next"
        #expect(model.canSend)
    }

    @Test func explainsFailuresWithoutServerText() {
        #expect(Problem(TelerAPIError.network) == .offline)
        #expect(Problem(TelerAPIError.updateRequired(minimumVersion: "2.0.0")) == .updateRequired)
        #expect(Problem(TelerAPIError.http(status: 401, code: nil, retryAfter: nil)) == .signedOut)
        #expect(Problem(TaskStreamError.connectionLost) == .streamStopped)
        #expect(Problem(TelerAPIError.invalidResponse) == .other)
    }
}
