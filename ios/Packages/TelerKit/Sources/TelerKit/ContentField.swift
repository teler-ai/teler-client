/// One part of a chat message, as Teler stores and streams it.
///
/// The server has many part types and adds more often. The app renders the
/// ones below natively; every other part, including a known type whose shape
/// changed, decodes as `.unknown` with its original JSON instead of failing the
/// whole message.
public enum ContentField: Sendable, Hashable {
    case text(String)
    /// A report's markdown. While streaming, an empty `title` marks a suffix of
    /// the previous report part rather than a new report.
    case report(title: String, markdown: String)
    case reasoning(String)
    case error(ContentError)
    case investigationPlan(InvestigationPlan)
    case unknown(type: String, raw: JSONValue)

    public var type: String {
        switch self {
        case .text: "text"
        case .report: "report"
        case .reasoning: "reasoning"
        case .error: "error"
        case .investigationPlan: "investigation_plan"
        case .unknown(let type, _): type
        }
    }
}

public struct ContentError: Sendable, Hashable {
    public let text: String
    public let code: String?

    public init(text: String, code: String? = nil) {
        self.text = text
        self.code = code
    }
}

extension ContentField: Decodable {
    public init(from decoder: Decoder) throws {
        self.init(json: try JSONValue(from: decoder))
    }

    public init(json: JSONValue) {
        let type = json["type"]?.stringValue ?? ""
        self = Self.known(type: type, json: json) ?? .unknown(type: type, raw: json)
    }

    private static func known(type: String, json: JSONValue) -> ContentField? {
        switch type {
        case "text":
            return json["text"]?.stringValue.map(ContentField.text)
        case "report":
            guard let title = json["title"]?.stringValue,
                let markdown = json["markdown"]?.stringValue
            else { return nil }
            return .report(title: title, markdown: markdown)
        case "reasoning":
            return json["text"]?.stringValue.map(ContentField.reasoning)
        case "error":
            guard let text = json["text"]?.stringValue else { return nil }
            return .error(ContentError(text: text, code: json["code"]?.stringValue))
        case "investigation_plan":
            return InvestigationPlan(json: json).map(ContentField.investigationPlan)
        default:
            return nil
        }
    }
}

/// The steps Teler is working through for one answer. Updates arrive as new
/// revisions of the same `planID`.
public struct InvestigationPlan: Sendable, Hashable {
    public struct Step: Sendable, Hashable, Identifiable {
        public let id: String
        public let label: String
        public let activity: String
        public let status: Status

        public init(id: String, label: String, activity: String, status: Status) {
            self.id = id
            self.label = label
            self.activity = activity
            self.status = status
        }
    }

    public enum Status: String, Sendable, Hashable {
        case pending
        case inProgress = "in_progress"
        case completed
        case superseded
        case failed
        case blocked
        case skipped
        case unknown
    }

    public let planID: String
    public let revision: Int
    public let steps: [Step]
    public let explanation: String?

    public init(planID: String, revision: Int, steps: [Step], explanation: String? = nil) {
        self.planID = planID
        self.revision = revision
        self.steps = steps
        self.explanation = explanation
    }

    init?(json: JSONValue) {
        guard json["schemaVersion"]?.intValue == 1,
            let planID = json["planId"]?.stringValue,
            let revision = json["revision"]?.intValue,
            let rawSteps = json["steps"]?.arrayValue
        else { return nil }
        var steps: [Step] = []
        for rawStep in rawSteps {
            guard let id = rawStep["id"]?.stringValue,
                let label = rawStep["label"]?.stringValue,
                let activity = rawStep["activity"]?.stringValue,
                let status = rawStep["status"]?.stringValue
            else { return nil }
            steps.append(
                Step(
                    id: id, label: label, activity: activity,
                    status: Status(rawValue: status) ?? .unknown))
        }
        self.init(
            planID: planID, revision: revision, steps: steps,
            explanation: json["explanation"]?.stringValue)
    }
}
