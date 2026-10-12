import Foundation

/// A figure an Agent's finding is about. A percent value is in percentage
/// points: -18 means −18%.
public struct AgentMetric: Sendable, Hashable {
    public let value: Double
    public let isPercent: Bool
    public let label: String
}

/// What an Agent found when its own rule matched a run: a flag on one run,
/// or an alert that stays open while later runs keep matching
/// (`packages/contracts/src/agent-run-flag.ts` and `agent-alert.ts`).
public struct AgentFinding: Sendable, Hashable, Identifiable {
    public enum Source: Sendable, Hashable {
        case flag(runID: String)
        case alert(alertID: String)
    }

    public var id: String {
        switch source {
        case .flag(let run): "flag:\(run)"
        case .alert(let alert): "alert:\(alert)"
        }
    }

    public let source: Source
    public let agentLabel: String
    public let title: String
    /// The Agent's own instruction that asked for it.
    public let rule: String?
    public let findings: Int
    /// Up to five one-line findings.
    public let items: [String]
    public let metric: AgentMetric?
    public let threshold: Double?
    /// When the finding last changed: a flag's run, or an alert's newest flagged run.
    public let at: Date
    /// Waiting for the member: an unseen flag, or an open alert with news they haven't seen.
    public let isWaiting: Bool
    /// An alert that closed on its own; it stays a day.
    public let isResolved: Bool
    /// Flagged runs in a row after the one that opened an alert.
    public let repeatCount: Int
    /// For a colleague's alert, whose Agent it is.
    public let ownerName: String?
    /// The flagged run, which only its owner can open.
    public let runID: String?

    init?(json: JSONValue) {
        guard let title = json["title"]?.stringValue, let label = json["agentLabel"]?.stringValue else {
            return nil
        }
        switch json["source"]?.stringValue {
        case "agent_run_flag":
            guard let run = json["runId"]?.stringValue, let at = Self.date(json["createdAt"]) else { return nil }
            source = .flag(runID: run)
            self.at = at
            isWaiting = json["status"]?.stringValue == "open"
            isResolved = json["status"]?.stringValue == "resolved"
            repeatCount = 0
            ownerName = nil
            runID = run
        case "agent_alert":
            guard let alert = json["alertId"]?.stringValue,
                let at = Self.date(json["lastFlaggedAt"]) ?? Self.date(json["openedAt"])
            else { return nil }
            source = .alert(alertID: alert)
            self.at = at
            let open = json["state"]?.stringValue == "open"
            isWaiting = open && json["seen"]?.boolValue == false
            isResolved = !open
            repeatCount = json["repeatCount"]?.intValue ?? 0
            ownerName = json["isOwner"]?.boolValue == false ? json["ownerName"]?.stringValue : nil
            runID = json["lastRunId"]?.stringValue
        default:
            return nil
        }
        agentLabel = label
        self.title = title
        rule = json["rule"]?.stringValue
        findings = json["findings"]?.intValue ?? 0
        items = json["items"]?.arrayValue?.compactMap(\.stringValue) ?? []
        if let metric = json["metric"], let value = metric["value"]?.doubleValue {
            self.metric = AgentMetric(
                value: value, isPercent: metric["format"]?.stringValue == "percent",
                label: metric["label"]?.stringValue ?? "")
        } else {
            metric = nil
        }
        threshold = json["threshold"]?.doubleValue
    }

    private static func date(_ value: JSONValue?) -> Date? {
        value?.stringValue.flatMap(TelerAPIClient.parseISO8601)
    }
}

/// Someone asking for read access to data the member approves.
public struct AccessRequest: Sendable, Hashable, Identifiable {
    public enum GroupKind: String, Sendable, Hashable {
        case connector
        case personalFiles = "personal_files"
        case organizationFiles = "organization_files"
    }

    public let id: String
    public let requesterID: String
    public let requesterName: String?
    public let groupKind: GroupKind
    public let ownerName: String?
    /// The connection's name, for tables.
    public let connectionName: String?
    /// How many tables or files they can't read yet.
    public let restrictedCount: Int
    public let reason: String
    public let isPending: Bool
    public let createdAt: Date

    init?(json: JSONValue) {
        guard let id = json["id"]?.stringValue, let requester = json["requester"]?["userId"]?.stringValue,
            let kind = json["group"]?["kind"]?.stringValue.flatMap(GroupKind.init(rawValue:)),
            let createdAt = json["createdAt"]?.stringValue.flatMap(TelerAPIClient.parseISO8601)
        else { return nil }
        self.id = id
        requesterID = requester
        requesterName = json["requester"]?["name"]?.stringValue
        groupKind = kind
        ownerName = json["group"]?["owner"]?["name"]?.stringValue
        connectionName = json["group"]?["connectionName"]?.stringValue
        restrictedCount = json["group"]?["restrictedCount"]?.intValue ?? 0
        reason = json["reason"]?.stringValue ?? ""
        isPending = json["status"]?.stringValue == "pending"
        self.createdAt = createdAt
    }
}

/// The tables or files a request names, for the approver to choose from.
/// The server doesn't know which ones the requester needs, so none starts chosen.
public struct AccessReviewItem: Sendable, Hashable, Identifiable {
    public let id: String
    public let isTable: Bool
    public let name: String
    public let rowCount: Int?
}

public enum AccessDecision: Sendable, Hashable {
    case give([String])
    /// One of the fixed reasons, so nothing written can name data the requester can't see.
    case decline(DeclineReason?)

    public enum DeclineReason: String, Sendable, Hashable, CaseIterable {
        case notNeeded = "not_needed"
        case sensitive
        case askForSummary = "ask_for_summary"
        case notNow = "not_now"
    }
}

extension TelerAPIClient {
    /// The member's Agent findings for Home. An alert's latest run also shows
    /// as a flag, so that flag is left out, as on the web.
    public func agentFindings(in organization: OrganizationID) async throws -> [AgentFinding] {
        let response = try await json(
            JSONValue.self, .get, "/api/home/flags",
            query: [
                URLQueryItem(name: "organizationId", value: organization.rawValue),
                URLQueryItem(name: "alerts", value: "1"),
            ])
        let all = (response["flags"]?.arrayValue ?? []).compactMap(AgentFinding.init(json:))
        let alertedRuns = Set(all.filter { if case .alert = $0.source { true } else { false } }.compactMap(\.runID))
        return all.filter { finding in
            guard case .flag(let run) = finding.source else { return true }
            return !alertedRuns.contains(run)
        }
    }

    /// Records that the member saw a finding, which takes it off Needs you.
    public func markSeen(_ finding: AgentFinding, in organization: OrganizationID) async throws {
        switch finding.source {
        case .flag(let run):
            _ = try await send(
                .post, "/api/home/flags/\(try Self.pathComponent(run))/seen",
                query: [URLQueryItem(name: "organizationId", value: organization.rawValue)]
            ).collectBody(limit: Self.maximumErrorBody)
        case .alert(let alert):
            _ = try await send(.post, "/api/alerts/\(try Self.pathComponent(alert))/seen")
                .collectBody(limit: Self.maximumErrorBody)
        }
    }

    /// Access requests the member can answer, newest first; their own requests are left out.
    public func pendingAccessRequests(in organization: OrganizationID, excluding user: String?)
        async throws -> [AccessRequest]
    {
        let activity = try await json(
            JSONValue.self, .get, "/api/access/activity",
            query: [URLQueryItem(name: "organizationId", value: organization.rawValue)])
        return (activity["pending"]?.arrayValue ?? []).compactMap(AccessRequest.init(json:))
            .filter { $0.isPending && $0.requesterID != user }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// The tables or files one request names.
    public func accessReview(_ request: String, in organization: OrganizationID) async throws -> [AccessReviewItem] {
        let review = try await json(
            JSONValue.self, .get, "/api/access/requests/\(try Self.pathComponent(request))/review",
            query: [URLQueryItem(name: "organizationId", value: organization.rawValue)])
        return (review["items"]?.arrayValue ?? []).compactMap { item in
            guard let id = item["id"]?.stringValue, let name = item["name"]?.stringValue else { return nil }
            return AccessReviewItem(
                id: id, isTable: item["kind"]?.stringValue == "table", name: name, rowCount: item["rowCount"]?.intValue)
        }
    }

    public func decideAccess(_ request: String, in organization: OrganizationID, _ decision: AccessDecision)
        async throws
    {
        let body: JSONValue =
            switch decision {
            case .give(let items):
                .object(["decision": .string("given"), "itemIds": .array(items.map(JSONValue.string))])
            case .decline(let reason):
                .object(["decision": .string("declined"), "reason": reason.map { .string($0.rawValue) } ?? .null])
            }
        _ = try await send(
            .post, "/api/access/requests/\(try Self.pathComponent(request))/decide",
            query: [URLQueryItem(name: "organizationId", value: organization.rawValue)], body: try Self.encode(body)
        ).collectBody(limit: Self.maximumErrorBody)
    }

    /// An identifier from the server, checked before it goes into a path.
    static func pathComponent(_ id: String) throws -> String {
        guard (1...128).contains(id.count),
            id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") })
        else { throw TelerAPIError.invalidResponse }
        return id
    }
}
