import Foundation
import Observation
import TelerKit

/// Home's "Needs you": what waits on the member, in the web's order
/// (`apps/chat/web/src/home/home-needs.ts`): Agent alerts with news, then
/// access requests to answer, then unseen Agent flags, at most three; alerts
/// that closed on their own follow quietly until they leave.
@MainActor @Observable
public final class NeedsYouModel {
    public enum Item: Identifiable, Hashable, Sendable {
        case finding(AgentFinding)
        case access(AccessRequest)

        public var id: String {
            switch self {
            case .finding(let finding): finding.id
            case .access(let request): "access:\(request.id)"
            }
        }
    }

    /// How many items Home shows before "more".
    public static let limit = 3

    private let workspace: Workspace
    private let user: String?
    /// Everything waiting, in order.
    public private(set) var items: [Item] = []
    /// Alerts that closed on their own.
    public private(set) var closed: [AgentFinding] = []
    public private(set) var isLoaded = false

    /// `user` is the member's own ID: their own access requests aren't theirs to answer.
    public init(workspace: Workspace, user: String?) {
        self.workspace = workspace
        self.user = user
    }

    public var waiting: [Item] { Array(items.prefix(Self.limit)) }

    /// Each source loads on its own, so one that fails doesn't hide the other.
    public func load() async {
        guard let organization = try? await workspace.activeOrganization() else { return }
        let client = workspace.client
        async let findings = client.agentFindings(in: organization)
        async let requests = client.pendingAccessRequests(in: organization, excluding: user)
        let loaded = (try? await findings) ?? []
        let pending = (try? await requests) ?? []
        guard !Task.isCancelled else { return }
        (items, closed) = Self.arrange(findings: loaded, requests: pending)
        isLoaded = true
    }

    static func arrange(findings: [AgentFinding], requests: [AccessRequest]) -> ([Item], [AgentFinding]) {
        func isAlert(_ finding: AgentFinding) -> Bool {
            if case .alert = finding.source { true } else { false }
        }
        let newestFirst: (AgentFinding, AgentFinding) -> Bool = { $0.at > $1.at }
        let alerts = findings.filter { isAlert($0) && $0.isWaiting }.sorted(by: newestFirst)
        let flags = findings.filter { !isAlert($0) && $0.isWaiting }.sorted(by: newestFirst)
        let rows = (alerts + flags).map(Item.finding)
        // Requests block a colleague, so they come right after alerts, and
        // always within the first three.
        let reviewAt = min(alerts.count, limit - 1)
        let items = Array(rows.prefix(reviewAt)) + requests.map(Item.access) + Array(rows.dropFirst(reviewAt))
        let closed = findings.filter { isAlert($0) && $0.isResolved }.sorted(by: newestFirst)
        return (items, closed)
    }

    /// Marks a finding as seen, which takes it off Needs you.
    public func markSeen(_ finding: AgentFinding) async throws {
        guard let organization = try await workspace.activeOrganization() else { throw Problem.noOrganization }
        try await workspace.client.markSeen(finding, in: organization)
        items.removeAll { $0.id == finding.id }
    }

    /// The tables or files a request names, to choose which to give access to.
    public func review(_ request: AccessRequest) async throws -> [AccessReviewItem] {
        guard let organization = try await workspace.activeOrganization() else { throw Problem.noOrganization }
        return try await workspace.client.accessReview(request.id, in: organization)
    }

    public func decide(_ request: AccessRequest, _ decision: AccessDecision) async throws {
        guard let organization = try await workspace.activeOrganization() else { throw Problem.noOrganization }
        try await workspace.client.decideAccess(request.id, in: organization, decision)
        items.removeAll { $0.id == Item.access(request).id }
    }
}
