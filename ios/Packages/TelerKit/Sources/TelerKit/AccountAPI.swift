import Foundation

/// An organization the member belongs to, with their role in it.
public struct OrganizationMembership: Sendable, Hashable, Identifiable, Decodable {
    public let id: String
    public let name: String
    /// `owner`, `admin` or `member`.
    public let role: String
    /// `free`, `professional` or `enterprise`.
    public let plan: String?
    /// `metered`, or a legacy plan whose chats don't use credits.
    public let creditMetering: String?

    public init(id: String, name: String, role: String, plan: String? = nil, creditMetering: String? = nil) {
        self.id = id
        self.name = name
        self.role = role
        self.plan = plan
        self.creditMetering = creditMetering
    }

    public var organization: OrganizationID? { OrganizationID(rawValue: id) }
}

/// The member's AI credits this month, and the organization's shared pool.
public struct Credits: Sendable, Hashable, Decodable {
    public struct Budget: Sendable, Hashable, Decodable {
        public let remaining: Double
        public let total: Double
        public let resetsAt: Date?
        public let metering: String?
    }

    public struct Pool: Sendable, Hashable, Decodable {
        public let remaining: Double
    }

    public let userBudget: Budget?
    public let orgPool: Pool?
}

/// A place the account is signed in. The server sends no session token here,
/// and the app reads no IP address.
public struct SignedInDevice: Sendable, Hashable, Identifiable, Decodable {
    public let id: String
    public let userAgent: String?
    public let createdAt: Date?
    public let updatedAt: Date?
    /// Signed in through the CLI.
    public let isCommandLine: Bool

    private enum CodingKeys: String, CodingKey {
        case id, userAgent, createdAt, updatedAt, cliOrganizationIds
    }

    public init(id: String, userAgent: String?, createdAt: Date? = nil, updatedAt: Date? = nil, isCommandLine: Bool = false) {
        self.id = id
        self.userAgent = userAgent
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.isCommandLine = isCommandLine
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        userAgent = try container.decodeIfPresent(String.self, forKey: .userAgent)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        isCommandLine = (try? container.decodeNil(forKey: .cliOrganizationIds)) == false
            && container.contains(.cliOrganizationIds)
    }
}

public struct SignedInDevices: Sendable, Decodable {
    public let sessions: [SignedInDevice]
    public let currentSessionId: String?
}

extension TelerAPIClient {
    /// Teler's own account routes answer `{ "success": true, "data": … }`.
    private struct Envelope<Value: Decodable>: Decodable {
        let data: Value
    }

    public func organizations() async throws -> [OrganizationMembership] {
        try await json(Envelope<[OrganizationMembership]>.self, .get, "/api/user/organizations").data
    }

    /// Makes `organization` the active one for this session and the default
    /// for the account's new sessions, as the web's switcher does.
    public func setActiveOrganization(_ organization: OrganizationID) async throws {
        struct Body: Encodable { let organizationId: String }
        struct Switched: Decodable { let organizationId: String }
        _ = try await json(
            Envelope<Switched>.self, .put, "/api/user/active-organization",
            body: try Self.encode(Body(organizationId: organization.rawValue)))
    }

    public func credits(for organization: OrganizationID) async throws -> Credits {
        try await json(Envelope<Credits>.self, .get, "/api/credits/\(organization.rawValue)").data
    }

    public func signedInDevices() async throws -> SignedInDevices {
        try await json(Envelope<SignedInDevices>.self, .get, "/api/user/sessions").data
    }

    public func signOutDevice(_ session: String) async throws {
        guard session.hasPrefix("ses"), (4...64).contains(session.count),
            session.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") })
        else { throw TelerAPIError.invalidResponse }
        _ = try await send(.delete, "/api/user/sessions/\(session)").collectBody(limit: Self.maximumErrorBody)
    }

    public func signOutOtherDevices() async throws {
        _ = try await send(.delete, "/api/user/sessions").collectBody(limit: Self.maximumErrorBody)
    }
}
