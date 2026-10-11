import Foundation
import Observation
import TelerKit

@MainActor @Observable
public final class ChatListModel {
    public enum Phase: Equatable {
        case loading
        case loaded
        case failed(Problem)
    }

    private let workspace: Workspace
    private let limit: Int
    public private(set) var chats: [ChatSummary] = []
    public private(set) var phase = Phase.loading

    /// `limit` is how many of the newest chats to show.
    public init(workspace: Workspace, limit: Int = 50) {
        self.workspace = workspace
        self.limit = limit
    }

    /// The active organization's chats, newest first.
    public func load() async {
        do {
            guard let organization = try await workspace.activeOrganization() else {
                phase = .failed(.noOrganization)
                return
            }
            chats = try await workspace.client.chats(limit: limit, organization: organization).chats
            phase = .loaded
        } catch is CancellationError {
            return
        } catch {
            if chats.isEmpty { phase = .failed(Problem(error)) }
        }
    }
}

/// Chats grouped by when they last changed, newest first.
public struct ChatSection: Identifiable, Hashable, Sendable {
    public enum Period: Hashable, Sendable {
        case today
        case yesterday
        case previousSevenDays
        case previousThirtyDays
        case month(year: Int, month: Int)
        case undated
    }

    public let period: Period
    public let chats: [ChatSummary]
    public var id: Period { period }

    /// Keeps the chats' order; a period appears once, where its first chat is.
    public static func group(
        _ chats: [ChatSummary], now: Date = Date(), calendar: Calendar = .current
    ) -> [ChatSection] {
        let today = calendar.startOfDay(for: now)
        var order: [Period] = []
        var grouped: [Period: [ChatSummary]] = [:]
        for chat in chats {
            let period = period(of: chat.updatedAt, today: today, calendar: calendar)
            if grouped[period] == nil { order.append(period) }
            grouped[period, default: []].append(chat)
        }
        return order.map { ChatSection(period: $0, chats: grouped[$0] ?? []) }
    }

    private static func period(of date: Date?, today: Date, calendar: Calendar) -> Period {
        guard let date else { return .undated }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: today).day ?? 0
        switch days {
        case ..<1: return .today
        case 1: return .yesterday
        case 2...7: return .previousSevenDays
        case 8...30: return .previousThirtyDays
        default:
            let parts = calendar.dateComponents([.year, .month], from: date)
            return .month(year: parts.year ?? 0, month: parts.month ?? 0)
        }
    }
}
