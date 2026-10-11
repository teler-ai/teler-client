import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// Today, search and new chats: what they ask the server, and what they show.
@MainActor @Suite struct WorkspaceModelTests {
    private static let organization = "org_01jczpznh32py20pd8y10ef9cq"
    private static let me = #"{"activeOrganizationId":"\#(organization)"}"#
    private static let oneChat =
        #"{"chats":[{"id":"chat_01jcee37e1fsbpkjgmdsqtg64p","title":"Churn by plan","updatedAt":"2026-10-12T09:12:00.000Z"}],"total":1,"hasMore":false}"#
    private static let prompts =
        #"{"prompts":[{"id":"starter-0","label":"Top products by revenue?","icon":"sparkles","type":"message"},{"id":"starter-1","label":"  ","icon":"search","type":"message"}]}"#

    private func ok(_ body: String) -> StubTransport.Reply {
        .response(status: 200, headers: ["Content-Type": "application/json"], chunks: [body])
    }

    private func query(_ request: HTTPRequest) -> [String: String] {
        let items = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    private func demoWorkspace() -> Workspace {
        Workspace(
            client: TelerAPIClient(
                origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
                transport: DemoTransport(chunkDelay: .zero)))
    }

    @Test func searchesTitlesInTheActiveOrganization() async throws {
        let transport = StubTransport([ok(Self.me), ok(Self.oneChat)])
        let search = ChatSearchModel(workspace: Workspace(client: .stubbed(transport)))
        await search.search("  churn ", after: .zero)
        #expect(search.phase == .found)
        #expect(search.results.map(\.title) == ["Churn by plan"])
        let request = try #require(transport.requests.last)
        #expect(request.url.path == "/api/chat/search")
        #expect(query(request) == ["q": "churn", "organizationId": Self.organization, "limit": "20"])
    }

    @Test func blankSearchAsksNothing() async {
        let transport = StubTransport([])
        let search = ChatSearchModel(workspace: Workspace(client: .stubbed(transport)))
        await search.search("   ", after: .zero)
        #expect(search.phase == .idle)
        #expect(transport.requests.isEmpty)
    }

    @Test func asksForStarterQuestionsOnceASession() async throws {
        let transport = StubTransport([ok(Self.me), ok(Self.prompts)])
        let workspace = Workspace(client: .stubbed(transport))
        #expect(await workspace.starterPrompts(language: "ca").map(\.label) == ["Top products by revenue?"])
        #expect(await workspace.starterPrompts(language: "ca").count == 1)
        #expect(transport.requests.map(\.url.path) == ["/api/teler-cli/me", "/api/chat/starter-prompts"])
        #expect(query(try #require(transport.requests.last)) == ["organizationId": Self.organization, "language": "ca"])
    }

    @Test func asksForStarterQuestionsAgainAfterAFailure() async {
        let transport = StubTransport([ok(Self.me), .failure, ok(Self.prompts)])
        let workspace = Workspace(client: .stubbed(transport))
        #expect(await workspace.starterPrompts(language: "en").isEmpty)
        #expect(await workspace.starterPrompts(language: "en").count == 1)
        #expect(transport.requests.count == 3)
    }

    @Test func todayShowsTheNewestChats() async {
        let home = HomeModel(workspace: demoWorkspace(), language: "en")
        await home.load()
        #expect(home.phase == .loaded)
        #expect(home.recent.count == HomeModel.recentCount)
        #expect(!home.isNewMember)
        #expect(home.suggestions.isEmpty)
    }

    @Test func todayOffersQuestionsToANewMember() async {
        let transport = StubTransport([
            ok(Self.me), ok(#"{"chats":[],"total":0,"hasMore":false}"#), ok(Self.prompts),
        ])
        let home = HomeModel(workspace: Workspace(client: .stubbed(transport)), language: "en")
        await home.load()
        #expect(home.isNewMember)
        #expect(home.suggestions.map(\.label) == ["Top products by revenue?"])
    }

    @Test func createsAChatOnlyWhenAQuestionIsAsked() async throws {
        let workspace = demoWorkspace()
        let newChat = NewChatModel(workspace: workspace, language: "en")
        #expect(!newChat.canStart)
        newChat.draft = "   "
        #expect(!newChat.canStart)
        newChat.draft = " Which region grew fastest? "
        #expect(newChat.canStart)
        let started = try #require(await newChat.start())
        #expect(started.question == "Which region grew fastest?")
        #expect(newChat.draft.isEmpty)

        let list = ChatListModel(workspace: workspace)
        await list.load()
        #expect(list.chats.contains { $0.id == started.chat })
    }

    @Test func groupsChatsByWhenTheyLastChanged() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
        let parse = { (text: String) in try Date(text, strategy: .iso8601) }
        let now = try parse("2026-10-13T10:00:00Z")
        let dates = try [
            "2026-10-13T08:00:00Z", "2026-10-12T20:00:00Z", "2026-10-09T09:00:00Z",
            "2026-10-08T09:00:00Z", "2026-09-20T09:00:00Z", "2026-05-22T09:00:00Z",
        ].map(parse)
        let chats = (dates.map(Optional.some) + [nil]).enumerated().map { index, date in
            ChatSummary(id: ChatID(rawValue: "chat_01jcee37e1fsbpkjgmdsqtg6\(index)p")!, title: nil, updatedAt: date)
        }
        let sections = ChatSection.group(chats, now: now, calendar: calendar)
        #expect(
            sections.map(\.period) == [
                .today, .yesterday, .previousSevenDays, .previousThirtyDays, .month(year: 2026, month: 5),
                .undated,
            ])
        #expect(sections.map(\.chats.count) == [1, 1, 2, 1, 1, 1])
    }

    @Test func greetsByThePartOfTheDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
        let at = { (hour: Int) in
            DayPart(Date(timeIntervalSince1970: TimeInterval(hour * 3600)), calendar: calendar)
        }
        #expect([at(9), at(14), at(21), at(3)] == [.morning, .afternoon, .evening, .evening])
        #expect(SignedInUser(id: "usr_1", name: "Laia Puig", email: nil).firstName == "Laia")
        #expect(SignedInUser(id: "usr_1", name: nil, email: "laia@example.com").firstName == nil)
    }
}
