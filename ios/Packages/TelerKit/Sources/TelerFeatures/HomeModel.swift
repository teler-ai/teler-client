import Foundation
import Observation
import TelerKit

/// Today: where the member left off, or for a new member questions to start with.
@MainActor @Observable
public final class HomeModel {
    public enum Phase: Equatable {
        case loading
        case loaded
        case failed(Problem)
    }

    /// How many recent chats "Continue" shows.
    public static let recentCount = 3

    private let workspace: Workspace
    private let language: String
    public private(set) var phase = Phase.loading
    public private(set) var recent: [ChatSummary] = []
    public private(set) var suggestions: [StarterPrompt] = []

    /// `language` is the language to write starter questions in, such as `ca`.
    public init(workspace: Workspace, language: String) {
        self.workspace = workspace
        self.language = language
    }

    /// A member with no chats yet sees questions to start from instead.
    public var isNewMember: Bool { phase == .loaded && recent.isEmpty }

    public func load() async {
        do {
            guard let organization = try await workspace.activeOrganization() else {
                phase = .failed(.noOrganization)
                return
            }
            let page = try await workspace.client.chats(limit: Self.recentCount, organization: organization)
            recent = Array(page.chats.prefix(Self.recentCount))
            phase = .loaded
        } catch is CancellationError {
            return
        } catch {
            if recent.isEmpty { phase = .failed(Problem(error)) }
            return
        }
        if recent.isEmpty, suggestions.isEmpty {
            suggestions = await workspace.starterPrompts(language: language)
        }
    }
}

/// The part of the day a greeting names.
public enum DayPart: Sendable, Equatable {
    case morning
    case afternoon
    case evening

    public init(_ date: Date, calendar: Calendar = .current) {
        switch calendar.component(.hour, from: date) {
        case 5..<12: self = .morning
        case 12..<19: self = .afternoon
        default: self = .evening
        }
    }
}

extension SignedInUser {
    /// The first word of the member's name, to greet them by.
    public var firstName: String? {
        name?.split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}
