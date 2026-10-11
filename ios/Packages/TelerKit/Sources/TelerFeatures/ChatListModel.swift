import Observation
import TelerKit

@MainActor @Observable
public final class ChatListModel {
    public enum Phase: Equatable {
        case loading
        case loaded
        case failed(Problem)
    }

    private let client: TelerAPIClient
    public private(set) var chats: [ChatSummary] = []
    public private(set) var phase = Phase.loading
    public private(set) var isCreating = false
    public var creationProblem: Problem?

    public init(client: TelerAPIClient) {
        self.client = client
    }

    public func load() async {
        do {
            chats = try await client.chats().chats
            phase = .loaded
        } catch is CancellationError {
            return
        } catch {
            if chats.isEmpty { phase = .failed(Problem(error)) }
        }
    }

    /// Creates a chat in the member's active organization.
    public func createChat() async -> ChatID? {
        isCreating = true
        defer { isCreating = false }
        do {
            guard let organization = try await client.activeOrganization() else {
                creationProblem = .noOrganization
                return nil
            }
            return try await client.createChat(in: organization)
        } catch {
            creationProblem = Problem(error)
            return nil
        }
    }
}
