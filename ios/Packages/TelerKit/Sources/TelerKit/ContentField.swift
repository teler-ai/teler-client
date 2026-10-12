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
    /// What Teler did for a step, in plain words. Ordinary members get this
    /// instead of the code or tool calls behind it.
    case activity(AnalysisActivity)
    /// A chart or table produced for the answer; its spec and data are fetched by slug.
    case chart(ChartReference)
    /// Follow-up questions to ask next.
    case quickActions([QuickAction])
    /// Web pages the answer drew on.
    case webSources([WebSource])
    /// A file or image the member attached to their question.
    case attachment(name: String?, isImage: Bool)
    /// A follow-up the member sent while Teler was working.
    case steering(text: String, delivered: Bool)
    /// Questions Teler asked; the turn waits for the member's answers.
    case question(AskUserCall)
    /// The member's answers to Teler's questions, on the message that sent them.
    case questionAnswers(QuestionAnswers)
    /// A permission Teler asked for before an action.
    case approval(ApprovalRequest)
    case unknown(type: String, raw: JSONValue)

    public var type: String {
        switch self {
        case .text: "text"
        case .report: "report"
        case .reasoning: "reasoning"
        case .error: "error"
        case .investigationPlan: "investigation_plan"
        case .activity: "analysis_activity"
        case .chart: "chart_artifact"
        case .quickActions: "quick_actions"
        case .webSources: "web_search"
        case .attachment(_, let isImage): isImage ? "image_reference" : "file_reference"
        case .steering: "steering"
        case .question: "ask_user"
        case .questionAnswers: "question_answers"
        case .approval: "web_approval"
        case .unknown(let type, _): type
        }
    }

    /// Parts the web app never shows to members: internal pipeline state,
    /// receipts and model reasoning. The app hides them too.
    public static let hiddenTypes: Set<String> = [
        "reasoning", "waiting_pipeline", "pipeline_error", "enriched_content", "deep_analysis_plan",
        "deep_analysis", "evidence_manifest", "source_citations", "chart_appearance_context",
        "agent_work_receipt", "verification", "run_references", "analysis_mode", "automatic_review",
        "code_execution", "tool_call", "next_steps", "memory_activity", "persistence_receipt",
        "question_answer_change",
    ]
}

public struct AnalysisActivity: Sendable, Hashable {
    /// Such as `checking-available-data` or `exploring-data`.
    public let kind: String
    /// `running`, `completed`, `retrying` or `delegation-failed`.
    public let status: String
    public let description: String?
    public let milliseconds: Int?
    public let planStepID: String?

    public init(
        kind: String, status: String, description: String? = nil, milliseconds: Int? = nil,
        planStepID: String? = nil
    ) {
        self.kind = kind
        self.status = status
        self.description = description
        self.milliseconds = milliseconds
        self.planStepID = planStepID
    }
}

public struct ChartReference: Sendable, Hashable {
    public let slug: String
    public let chartType: String
    public let title: String
    public let description: String?

    public init(slug: String, chartType: String, title: String, description: String? = nil) {
        self.slug = slug
        self.chartType = chartType
        self.title = title
        self.description = description
    }
}

public struct QuickAction: Sendable, Hashable {
    public let label: String
    /// The question it asks.
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

public struct WebSource: Sendable, Hashable {
    public let url: String
    public let title: String?

    public init(url: String, title: String? = nil) {
        self.url = url
        self.title = title
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
            let code = json["errorCode"]?.stringValue ?? json["code"]?.stringValue
            return .error(ContentError(text: text, code: code))
        case "investigation_plan":
            return InvestigationPlan(json: json).map(ContentField.investigationPlan)
        case "analysis_activity":
            guard let kind = json["activity"]?.stringValue, let status = json["status"]?.stringValue else {
                return nil
            }
            return .activity(
                AnalysisActivity(
                    kind: kind, status: status, description: json["description"]?.stringValue,
                    milliseconds: json["executionTimeMs"]?.intValue,
                    planStepID: json["investigationStepId"]?.stringValue))
        case "chart_artifact":
            guard let slug = json["slug"]?.stringValue, let title = json["title"]?.stringValue else {
                return nil
            }
            return .chart(
                ChartReference(
                    slug: slug, chartType: json["chartType"]?.stringValue ?? "", title: title,
                    description: json["description"]?.stringValue))
        case "quick_actions":
            let actions = (json["actions"]?.arrayValue ?? []).compactMap { action -> QuickAction? in
                guard let label = action["label"]?.stringValue, let value = action["value"]?.stringValue,
                    !label.isEmpty, !value.isEmpty
                else { return nil }
                return QuickAction(label: label, value: value)
            }
            return actions.isEmpty ? nil : .quickActions(actions)
        case "web_search":
            let sources = (json["sources"]?.arrayValue ?? []).compactMap { source -> WebSource? in
                guard let url = source["url"]?.stringValue else { return nil }
                return WebSource(url: url, title: source["title"]?.stringValue)
            }
            return sources.isEmpty ? nil : .webSources(sources)
        case "image_reference":
            return .attachment(name: nil, isImage: true)
        case "file_reference":
            return .attachment(name: json["name"]?.stringValue, isImage: json["preview"]?.stringValue == "image")
        case "steering":
            guard let text = json["text"]?.stringValue else { return nil }
            return .steering(text: text, delivered: json["delivery"]?.stringValue != "undelivered")
        case "tool_call" where json["toolName"]?.stringValue == "askUser":
            return AskUserCall(json: json).map(ContentField.question)
        case "question_answers":
            return QuestionAnswers(json: json).map(ContentField.questionAnswers)
        case "web_approval":
            return ApprovalRequest(json: json).map(ContentField.approval)
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
