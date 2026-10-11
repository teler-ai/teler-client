import Foundation

public struct ChatSummary: Sendable, Hashable, Identifiable, Decodable {
    public let id: ChatID
    public let title: String?
    public let updatedAt: Date?

    public init(id: ChatID, title: String?, updatedAt: Date? = nil) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
    }
}

public struct ChatPage: Sendable, Decodable {
    public let chats: [ChatSummary]
    public let total: Int
    public let hasMore: Bool
}

public enum MessageRole: String, Sendable, Hashable, Decodable {
    case user
    case assistant
    case other

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
    }
}

public struct ChatMessage: Sendable, Hashable, Identifiable, Decodable {
    public let id: MessageID
    public let role: MessageRole
    public var content: [ContentField]
    public let createdAt: Date?
    public let completedAt: Date?
    /// The server's view of an assistant turn, such as `running_runner`,
    /// `completed`, `failed` or `interrupted`.
    public let turnState: String?

    public init(
        id: MessageID, role: MessageRole, content: [ContentField], createdAt: Date? = nil,
        completedAt: Date? = nil, turnState: String? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.turnState = turnState
    }

    private enum CodingKeys: String, CodingKey {
        case id, role, content, createdAt, completedAt, turnState
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(MessageID.self, forKey: .id)
        role = try container.decode(MessageRole.self, forKey: .role)
        // User messages may be stored as a plain string.
        if let text = try? container.decode(String.self, forKey: .content) {
            content = [.text(text)]
        } else {
            content = try container.decodeIfPresent([ContentField].self, forKey: .content) ?? []
        }
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        turnState = try container.decodeIfPresent(String.self, forKey: .turnState)
    }
}

/// A chat turn still running on the server, which a reopened chat reattaches to.
public struct ActiveTask: Sendable, Hashable, Decodable {
    public let id: TaskID
    public let messageId: MessageID
    public let status: String
    public let canCancel: Bool?
}

public struct ChatDetail: Sendable, Decodable {
    public let id: ChatID
    public let title: String?
    public var messages: [ChatMessage]
    public let activeAgentTask: ActiveTask?

    public init(id: ChatID, title: String?, messages: [ChatMessage], activeAgentTask: ActiveTask? = nil)
    {
        self.id = id
        self.title = title
        self.messages = messages
        self.activeAgentTask = activeAgentTask
    }
}

/// What `POST /api/chat/:id/message` returns: the queued turn.
public struct TurnAcceptance: Sendable, Hashable, Decodable {
    public let taskId: TaskID
    public let messageId: MessageID
}

public enum ModelSet: String, Sendable, Encodable {
    case lite
    case pro
}
