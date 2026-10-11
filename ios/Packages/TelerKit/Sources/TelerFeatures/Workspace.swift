import TelerKit

/// What the screens of one session, or of the demo, share: the client, the
/// member's active organization and the starter questions written for it.
@MainActor
public final class Workspace {
    public let client: TelerAPIClient
    private var organization: OrganizationID?
    private var prompts: [StarterPrompt]?
    private var promptsRequest: Task<[StarterPrompt]?, Never>?

    public init(client: TelerAPIClient) {
        self.client = client
    }

    /// The member's active organization, or nil when they have none yet.
    public func activeOrganization() async throws -> OrganizationID? {
        if let organization { return organization }
        let found = try await client.activeOrganization()
        organization = found
        return found
    }

    /// Starter questions for the active organization, or none when they can't
    /// be had. Teler may write them with a model on the organization's credits,
    /// so they're asked for once a session; a failed request is tried again later.
    public func starterPrompts(language: String) async -> [StarterPrompt] {
        if let prompts { return prompts }
        let request =
            promptsRequest
            ?? Task {
                guard let organization = try? await activeOrganization() else { return nil }
                return try? await client.starterPrompts(in: organization, language: language)
            }
        promptsRequest = request
        let found = await request.value
        promptsRequest = nil
        prompts = found
        return found ?? []
    }
}
