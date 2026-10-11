import Foundation
import Observation
import TelerKit

/// A chat that doesn't exist yet: it's created when the first question is
/// asked, so leaving without asking leaves no empty chat behind.
@MainActor @Observable
public final class NewChatModel {
    /// The created chat and the question it should ask first.
    public struct Started: Hashable, Sendable {
        public let chat: ChatID
        public let question: String
    }

    private let workspace: Workspace
    private let language: String
    public var draft = ""
    public private(set) var suggestions: [StarterPrompt] = []
    public private(set) var isStarting = false
    public var problem: Problem?

    public init(workspace: Workspace, language: String) {
        self.workspace = workspace
        self.language = language
    }

    public var canStart: Bool {
        !isStarting && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public func loadSuggestions() async {
        suggestions = await workspace.starterPrompts(language: language)
    }

    /// Creates the chat in the active organization for `question`, or for the draft.
    public func start(asking question: String? = nil) async -> Started? {
        let text = (question ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStarting else { return nil }
        isStarting = true
        defer { isStarting = false }
        do {
            guard let organization = try await workspace.activeOrganization() else {
                problem = .noOrganization
                return nil
            }
            let chat = try await workspace.client.createChat(in: organization)
            draft = ""
            return Started(chat: chat, question: text)
        } catch {
            problem = Problem(error)
            return nil
        }
    }
}
