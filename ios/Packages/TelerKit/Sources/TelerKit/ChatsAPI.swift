import Foundation

/// The chat endpoints the app uses, with the same request shapes as the CLI.
extension TelerAPIClient {
    public func chats(limit: Int = 30, offset: Int = 0, organization: OrganizationID? = nil)
        async throws -> ChatPage
    {
        var query = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if let organization {
            query.append(URLQueryItem(name: "organizationId", value: organization.rawValue))
        }
        return try await json(ChatPage.self, .get, "/api/chat", query: query)
    }

    /// The organization's chats whose title contains `text`, newest first.
    public func searchChats(_ text: String, in organization: OrganizationID, limit: Int = 20)
        async throws -> ChatPage
    {
        try await json(
            ChatPage.self, .get, "/api/chat/search",
            query: [
                URLQueryItem(name: "q", value: String(text.prefix(200))),
                URLQueryItem(name: "organizationId", value: organization.rawValue),
                URLQueryItem(name: "limit", value: String(limit)),
            ])
    }

    /// Questions written for the organization's own tables. Teler may write
    /// them with a model on the organization's credits, so ask once and keep them.
    public func starterPrompts(in organization: OrganizationID, language: String) async throws
        -> [StarterPrompt]
    {
        struct Response: Decodable { let prompts: [StarterPrompt] }
        let response = try await json(
            Response.self, .get, "/api/chat/starter-prompts",
            query: [
                URLQueryItem(name: "organizationId", value: organization.rawValue),
                URLQueryItem(name: "language", value: String(language.prefix(35))),
            ])
        return response.prompts.filter { !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    public func chat(_ id: ChatID, messageLimit: Int = 200) async throws -> ChatDetail {
        try await json(
            ChatDetail.self, .get, "/api/chat/\(id.rawValue)",
            query: [
                URLQueryItem(name: "includeMessages", value: "true"),
                URLQueryItem(name: "messageLimit", value: String(messageLimit)),
            ])
    }

    public func createChat(in organization: OrganizationID, title: String? = nil) async throws
        -> ChatID
    {
        struct Body: Encodable {
            let organizationId: String
            let mindsetName = "default"
            let title: String?
        }
        struct Created: Decodable { let id: ChatID }
        let body = try Self.encode(Body(organizationId: organization.rawValue, title: title))
        return try await json(Created.self, .post, "/api/chat", body: body).id
    }

    /// Queues a user turn. The answer then streams from `taskEvents`.
    public func sendMessage(
        _ text: String, to chat: ChatID, modelSet: ModelSet = .lite, deepAnalysis: Bool = false
    ) async throws -> TurnAcceptance {
        struct Message: Encodable {
            let id: String
            let role = "user"
            let content: String
        }
        struct Body: Encodable {
            let messages: [Message]
            let modelSet: ModelSet
            let deepAnalysis: Bool
        }
        let message = Message(id: "ios_\(UUID().uuidString.lowercased())", content: text)
        let body = try Self.encode(
            Body(messages: [message], modelSet: modelSet, deepAnalysis: deepAnalysis))
        let response = try await send(.post, "/api/chat/\(chat.rawValue)/message", body: body)
        guard response.head.statusCode == 202 else { throw TelerAPIError.invalidResponse }
        let data = try await response.collectBody(limit: Self.maximumErrorBody)
        do {
            return try Self.makeDecoder().decode(TurnAcceptance.self, from: data)
        } catch {
            throw TelerAPIError.invalidResponse
        }
    }

    /// The signed-in member's active organization. This is the CLI session's
    /// endpoint; the mobile session will get its own.
    public func activeOrganization() async throws -> OrganizationID? {
        struct Me: Decodable { let activeOrganizationId: String? }
        let me = try await json(Me.self, .get, "/api/teler-cli/me")
        return me.activeOrganizationId.flatMap(OrganizationID.init(rawValue:))
    }
}
