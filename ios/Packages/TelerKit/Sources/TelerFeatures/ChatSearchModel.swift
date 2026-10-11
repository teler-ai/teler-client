import Foundation
import Observation
import TelerKit

/// Finds chats by title as the member types, like the web's chat search.
@MainActor @Observable
public final class ChatSearchModel {
    public enum Phase: Equatable {
        case idle
        case searching
        case found
        case failed(Problem)
    }

    private let workspace: Workspace
    public private(set) var phase = Phase.idle
    public private(set) var results: [ChatSummary] = []

    public init(workspace: Workspace) {
        self.workspace = workspace
    }

    /// Searches after a short pause, so typing sends one request rather than
    /// one per key. Run it from a task keyed by the text: a newer text cancels it.
    public func search(_ text: String, after pause: Duration = .milliseconds(300)) async {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            phase = .idle
            results = []
            return
        }
        phase = .searching
        do {
            try await Task.sleep(for: pause)
            guard let organization = try await workspace.activeOrganization() else {
                phase = .failed(.noOrganization)
                return
            }
            let found = try await workspace.client.searchChats(text, in: organization).chats
            try Task.checkCancellation()
            results = found
            phase = .found
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            phase = .failed(Problem(error))
        }
    }
}
