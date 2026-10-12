import Foundation

/// Whether the member's account can be deleted now, and how they prove it's
/// them (`packages/contracts/src/account-deletion.ts`).
public struct AccountDeletionCheck: Sendable, Hashable {
    public enum Proof: Sendable, Hashable {
        /// The account's password.
        case password
        /// A code emailed to the member, for accounts without a password.
        case emailCode
    }

    public struct Blocker: Sendable, Hashable {
        /// Such as `shared_organization_owner` or `personal_subscription_active`.
        public let code: String
        public let organizationID: String?
    }

    public struct Organization: Sendable, Hashable, Identifiable {
        public let id: String
        public let name: String
        public let slug: String
        public let role: String
        public let otherMembers: Int
        /// Members who could become owner.
        public let possibleOwners: Int
    }

    public let canDelete: Bool
    public let proof: Proof
    /// The authenticator code is needed too.
    public let needsCode: Bool
    public let blockers: [Blocker]
    public let organizations: [Organization]
    /// Shared organizations the member leaves.
    public let organizationsLeaving: Int

    public init?(json: JSONValue) {
        guard let canDelete = json["canDelete"]?.boolValue, let identity = json["identity"] else { return nil }
        self.canDelete = canDelete
        proof = identity["method"]?.stringValue == "email" ? .emailCode : .password
        needsCode = identity["totpRequired"]?.boolValue == true
        blockers = (json["blockers"]?.arrayValue ?? []).compactMap { blocker in
            blocker["code"]?.stringValue.map { Blocker(code: $0, organizationID: blocker["organizationId"]?.stringValue) }
        }
        organizations = (json["organizations"]?.arrayValue ?? []).compactMap { organization in
            guard let id = organization["id"]?.stringValue, let name = organization["name"]?.stringValue,
                let slug = organization["slug"]?.stringValue
            else { return nil }
            return Organization(
                id: id, name: name, slug: slug, role: organization["currentMemberRole"]?.stringValue ?? "",
                otherMembers: organization["otherMemberCount"]?.intValue ?? 0,
                possibleOwners: organization["eligibleSuccessorCount"]?.intValue ?? 0)
        }
        organizationsLeaving = json["consequences"]?["sharedOrganizationsLeaving"]?.intValue ?? 0
    }
}

/// How the member proves it's them when confirming.
public enum AccountDeletionProof: Sendable, Hashable {
    case password(String)
    /// The 64-character code from the email.
    case emailCode(String)
}

/// Where a deletion stands once confirmed: it finishes in the background.
public enum AccountDeletionStatus: Sendable, Hashable {
    case processing
    case deleted
    case unknown
}

extension TelerAPIClient {
    /// The phrase the server requires; the app asks for confirmation with a system alert.
    static let deletionConfirmation = "DELETE MY ACCOUNT"

    public func accountDeletionCheck() async throws -> AccountDeletionCheck {
        let response = try await json(JSONValue.self, .get, "/api/account/preflight")
        guard let check = AccountDeletionCheck(json: response["data"] ?? .null) else {
            throw TelerAPIError.invalidResponse
        }
        return check
    }

    /// Starts a deletion and returns its operation. Every later step of the
    /// same deletion uses the same `key`; the server also sets a cookie for it.
    public func prepareAccountDeletion(key: String) async throws -> String {
        let response = try await json(
            JSONValue.self, .post, "/api/account/prepare", headers: ["Idempotency-Key": try Self.deletionKey(key)])
        guard let operation = response["data"]?["operationId"]?.stringValue else {
            throw TelerAPIError.invalidResponse
        }
        return operation
    }

    /// Emails the code an account without a password proves itself with.
    public func sendAccountDeletionCode(operation: String, key: String) async throws {
        struct Body: Encodable { let operationId: String }
        _ = try await send(
            .post, "/api/account/identity-email", headers: ["Idempotency-Key": try Self.deletionKey(key)],
            body: try Self.encode(Body(operationId: operation))
        ).collectBody(limit: Self.maximumErrorBody)
    }

    /// Confirms the deletion. A wrong password or code is
    /// `.http(401, "REAUTHENTICATION_REQUIRED", _)`.
    public func confirmAccountDeletion(
        operation: String, key: String, proof: AccountDeletionProof, authenticatorCode: String?
    ) async throws -> AccountDeletionStatus {
        struct Body: Encodable {
            let operationId: String
            let confirmation: String
            let password: String?
            let emailToken: String?
            let totpCode: String?
        }
        var password: String?
        var emailToken: String?
        switch proof {
        case .password(let value): password = value
        case .emailCode(let value): emailToken = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        let response = try await json(
            JSONValue.self, .post, "/api/account/confirm", headers: ["Idempotency-Key": try Self.deletionKey(key)],
            body: try Self.encode(
                Body(
                    operationId: operation, confirmation: Self.deletionConfirmation, password: password,
                    emailToken: emailToken, totpCode: authenticatorCode)))
        return Self.deletionStatus(response["data"])
    }

    /// Asks whether a confirmed deletion has finished. It needs no session,
    /// which the deletion has already ended.
    public func accountDeletionStatus(operation: String, key: String) async throws -> AccountDeletionStatus {
        struct Body: Encodable {
            let operationId: String
            let idempotencyKey: String
        }
        let response = try await json(
            JSONValue.self, .post, "/api/account/completion",
            body: try Self.encode(Body(operationId: operation, idempotencyKey: try Self.deletionKey(key))))
        return Self.deletionStatus(response["data"])
    }

    private static func deletionStatus(_ data: JSONValue?) -> AccountDeletionStatus {
        if data?["deleted"]?.boolValue == true || data?["status"]?.stringValue == "completed" { return .deleted }
        return data?["status"]?.stringValue == "processing" ? .processing : .unknown
    }

    /// Keys of 16 to 120 letters, digits, colons, underscores and hyphens.
    static func deletionKey(_ key: String) throws -> String {
        guard (16...120).contains(key.count),
            key.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || ":_-".contains($0)) })
        else { throw TelerAPIError.invalidEndpoint }
        return key
    }
}
