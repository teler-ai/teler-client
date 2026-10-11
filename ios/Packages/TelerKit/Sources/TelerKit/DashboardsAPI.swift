import Foundation

/// A dashboard in the list: enough to recognize it, without its data.
public struct DashboardSummary: Sendable, Hashable, Identifiable, Decodable {
    public struct WidgetPreview: Sendable, Hashable, Decodable {
        public let artifactType: String
        public let title: String
    }

    public let id: DashboardID
    public let name: String
    public let description: String?
    /// `owner`, `edit` or `view`.
    public let permission: String?
    public let lastRefreshedAt: Date?
    public let updatedAt: Date?
    public let widgetCount: Int?
    public let widgetPreviews: [WidgetPreview]?

    public init(
        id: DashboardID, name: String, description: String? = nil, permission: String? = "owner",
        lastRefreshedAt: Date? = nil, updatedAt: Date? = nil, widgetCount: Int? = nil,
        widgetPreviews: [WidgetPreview]? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.permission = permission
        self.lastRefreshedAt = lastRefreshedAt
        self.updatedAt = updatedAt
        self.widgetCount = widgetCount
        self.widgetPreviews = widgetPreviews
    }
}

public struct DashboardPage: Sendable, Decodable {
    public let dashboards: [DashboardSummary]
    public let hasMore: Bool
    public let nextCursor: String?
}

/// One dashboard's widgets and how fresh their data is.
public struct DashboardDetail: Sendable, Decodable {
    public struct Refresh: Sendable, Hashable, Decodable {
        /// `ready`, `partial`, `failed`, `never_refreshed`, `queued` or `running`.
        public let status: String
        public let lastAttemptAt: Date?
    }

    public let id: DashboardID
    public let name: String
    public let description: String?
    public let lastRefreshedAt: Date?
    public let refresh: Refresh?
    public let widgets: [DashboardWidget]
}

public struct DashboardWidget: Sendable, Hashable, Identifiable, Decodable {
    public struct Position: Sendable, Hashable, Decodable {
        /// On a grid four columns wide.
        public let x: Int
        public let y: Int
        public let w: Int
        public let h: Int
    }

    public struct Artifact: Sendable, Hashable, Decodable {
        /// The chart format's type, such as `metric`, `line` or `table`.
        public let type: String
        public let title: String?
        public let description: String?
    }

    public let id: String
    public let position: Position
    public let sortOrder: Int?
    public let artifact: Artifact
    /// Why the last refresh failed, such as `data_source_unavailable`; never the server's text.
    public let refreshError: String?

    private enum CodingKeys: String, CodingKey {
        case id, position, sortOrder, artifact, config
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        position = try container.decode(Position.self, forKey: .position)
        sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder)
        artifact = try container.decode(Artifact.self, forKey: .artifact)
        let config = try container.decodeIfPresent(JSONValue.self, forKey: .config)
        let state = config?["refreshState"]
        refreshError =
            state?["status"]?.stringValue == "error"
            ? state?["error"]?["reason"]?.stringValue.flatMap(Self.reason) ?? "unknown" : nil
    }

    /// Accepts only reason codes, so no free-form server text reaches the screen.
    private static func reason(_ value: String) -> String? {
        let allowed = (1...64).contains(value.count) && value.allSatisfy { $0.isLetter || $0 == "_" }
        return allowed ? value : nil
    }
}

extension TelerAPIClient {
    /// The organization's dashboards the member can see, recently updated first.
    public func dashboards(
        in organization: OrganizationID, matching text: String? = nil, cursor: String? = nil, limit: Int = 30
    ) async throws -> DashboardPage {
        var query = [
            URLQueryItem(name: "organizationId", value: organization.rawValue),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "sort", value: "updatedAt"),
            URLQueryItem(name: "order", value: "desc"),
        ]
        if let text, !text.isEmpty { query.append(URLQueryItem(name: "query", value: String(text.prefix(200)))) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await json(DashboardPage.self, .get, "/api/dashboard", query: query)
    }

    /// A dashboard's widgets without their data, which `widgetSpec` reads.
    public func dashboard(_ id: DashboardID) async throws -> DashboardDetail {
        try await json(
            DashboardDetail.self, .get, "/api/dashboard/\(id.rawValue)",
            query: [URLQueryItem(name: "include", value: "metadata")])
    }

    /// A widget's chart, table or metric, in the same format as chat charts.
    public func widgetSpec(dashboard: DashboardID, widget: String) async throws -> ChartSpec {
        guard (1...128).contains(widget.count),
            widget.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
        else { throw TelerAPIError.invalidResponse }
        let json = try await json(
            JSONValue.self, .get, "/api/dashboard/\(dashboard.rawValue)/widget/\(widget)/data")
        guard let spec = ChartSpec(json: json) else { throw TelerAPIError.invalidResponse }
        return spec
    }
}
