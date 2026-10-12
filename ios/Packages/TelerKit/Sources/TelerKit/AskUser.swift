import Foundation

/// Questions Teler asks while it works (its `askUser` tool). The turn ends
/// with them; the member's next message carries the answers.
public struct AskUserCall: Sendable, Hashable {
    public enum Status: String, Sendable {
        /// Shown to the member, waiting for answers.
        case shown
        /// Answered with Teler's picks, as in a scheduled run.
        case auto
        case unknown
    }

    public let toolCallID: String
    public let questions: [AskUserQuestion]
    public let status: Status

    public init(toolCallID: String, questions: [AskUserQuestion], status: Status) {
        self.toolCallID = toolCallID
        self.questions = questions
        self.status = status
    }

    /// A valid call, with the web's bounds (`ask-user-parse.ts`); nil for a malformed one.
    init?(json: JSONValue) {
        guard let id = json["toolCallId"]?.stringValue?.trimmed, !id.isEmpty,
            let items = json["input"]?["questions"]?.arrayValue, (1...3).contains(items.count)
        else { return nil }
        var questions: [AskUserQuestion] = []
        for item in items {
            guard let question = AskUserQuestion(json: item) else { return nil }
            questions.append(question)
        }
        toolCallID = id
        self.questions = questions
        status = Status(rawValue: json["output"]?["status"]?.stringValue ?? "") ?? .unknown
    }
}

public struct AskUserQuestion: Sendable, Hashable {
    public struct Option: Sendable, Hashable {
        public let label: String
        public let description: String

        public init(label: String, description: String) {
            self.label = label
            self.description = description
        }
    }

    /// A short name for the question, such as "Revenue".
    public let header: String
    public let question: String
    public let context: String?
    /// Two to four options; the first is Teler's recommendation.
    public let options: [Option]
    /// Why Teler recommends the first option.
    public let why: String

    public init(header: String, question: String, context: String? = nil, options: [Option], why: String) {
        self.header = header
        self.question = question
        self.context = context
        self.options = options
        self.why = why
    }

    init?(json: JSONValue) {
        func text(_ key: String, _ limit: Int, from value: JSONValue = json) -> String? {
            guard let text = value[key]?.stringValue?.trimmed, !text.isEmpty, text.utf16.count <= limit else {
                return nil
            }
            return text
        }
        guard let header = text("header", 60), let question = text("question", 300), let why = text("why", 300),
            let items = json["options"]?.arrayValue, (2...4).contains(items.count)
        else { return nil }
        var options: [Option] = []
        for item in items {
            guard let label = text("label", 120, from: item),
                let description = item["description"]?.stringValue?.trimmed, description.utf16.count <= 300
            else { return nil }
            options.append(Option(label: label, description: description))
        }
        if let context = json["context"], context != .null, text("context", 300) == nil { return nil }
        self.init(header: header, question: question, context: text("context", 300), options: options, why: why)
    }
}

/// One answer to one question; `text` answers are the member's own words.
public struct QuestionAnswer: Sendable, Hashable, Codable {
    public enum Kind: String, Sendable, Hashable, Codable {
        case option
        case text
    }

    public let header: String
    public let question: String
    public let answer: String
    public let kind: Kind
    /// True when the answer is the option Teler listed first as its pick.
    public let recommended: Bool

    public init(header: String, question: String, answer: String, kind: Kind, recommended: Bool) {
        self.header = header
        self.question = question
        self.answer = answer
        self.kind = kind
        self.recommended = recommended
    }

    /// Picking option `index` of `question`.
    public init(_ question: AskUserQuestion, option index: Int) {
        self.init(
            header: question.header, question: question.question, answer: question.options[index].label,
            kind: .option, recommended: index == 0)
    }

    /// Answering `question` in the member's own words.
    public init(_ question: AskUserQuestion, ownWords: String) {
        self.init(header: question.header, question: question.question, answer: ownWords, kind: .text, recommended: false)
    }
}

/// The answers to one call: sent with the member's message as its receipt,
/// and stored on that message as a `question_answers` part.
public struct QuestionAnswers: Sendable, Hashable, Codable {
    public enum Source: String, Sendable, Hashable, Codable {
        case user
        /// No answer in 30 seconds, so Teler's picks.
        case auto
    }

    public let toolCallId: String
    public let source: Source
    public let answers: [QuestionAnswer]

    public init(toolCallId: String, source: Source, answers: [QuestionAnswer]) {
        self.toolCallId = toolCallId
        self.source = source
        self.answers = answers
    }

    init?(json: JSONValue) {
        guard let data = try? JSONEncoder().encode(json),
            let decoded = try? JSONDecoder().decode(QuestionAnswers.self, from: data)
        else { return nil }
        self = decoded
    }

    /// One message's limit on the server.
    public static let textLimit = 4000

    /// The message text the model reads, as the web composes it in English
    /// (`ask-user-text.ts`). Typed answers that would overflow one message are
    /// cut, the longest first, each visibly.
    public var text: String {
        let text = lines(answers)
        guard text.utf16.count > Self.textLimit else { return text }
        let blank = answers.map { $0.kind == .text ? $0.with(answer: "") : $0 }
        var room = Self.textLimit - lines(blank).utf16.count
        let typed = answers.indices.filter { answers[$0].kind == .text }
            .sorted { answers[$0].answer.utf16.count < answers[$1].answer.utf16.count }
        var caps: [Int: Int] = [:]
        for (position, index) in typed.enumerated() {
            let cap = min(answers[index].answer.utf16.count, room / (typed.count - position))
            caps[index] = cap
            room -= cap
        }
        return lines(
            answers.indices.map { index in
                guard let cap = caps[index] else { return answers[index] }
                return answers[index].with(answer: Self.clamp(answers[index].answer, max(1, cap)))
            })
    }

    /// The receipt within the server's field limits: at most three answers,
    /// headers of 60, questions of 300 and answers of 2,000 characters.
    public var clamped: QuestionAnswers {
        QuestionAnswers(
            toolCallId: toolCallId, source: source,
            answers: answers.prefix(3).map { answer in
                QuestionAnswer(
                    header: Self.clamp(answer.header, 60), question: Self.clamp(answer.question, 300),
                    answer: Self.clamp(answer.answer, 2000), kind: answer.kind, recommended: answer.recommended)
            })
    }

    private func lines(_ answers: [QuestionAnswer]) -> String {
        let intro =
            source == .auto
            ? "No answer in 30 seconds, so go with your recommended answers:" : "Answers to your questions:"
        let lines = answers.map { answer in
            switch (answer.kind, answer.recommended) {
            case (.text, _): "- \(answer.question) → \(answer.answer) (in my own words)"
            case (.option, true): "- \(answer.question) → \(answer.answer) (your recommendation)"
            case (.option, false): "- \(answer.question) → \(answer.answer)"
            }
        }
        return ([intro] + lines).joined(separator: "\n")
    }

    /// At most `limit` UTF-16 units, ending in an ellipsis when cut, without
    /// splitting a surrogate pair.
    static func clamp(_ value: String, _ limit: Int) -> String {
        let units = Array(value.utf16)
        guard units.count > limit else { return value }
        var cut = Array(units.prefix(limit - 1))
        if let last = cut.last, (0xD800...0xDBFF).contains(last) { cut.removeLast() }
        return String(decoding: cut, as: UTF16.self) + "…"
    }
}

extension QuestionAnswer {
    fileprivate func with(answer: String) -> QuestionAnswer {
        QuestionAnswer(header: header, question: question, answer: answer, kind: kind, recommended: recommended)
    }
}

/// A permission Teler asked for before an action, such as searching the web
/// (a `web_approval` part).
public struct ApprovalRequest: Sendable, Hashable {
    public let approvalID: String
    /// The action: `webSearch`, `webFetch`, `exploreData` or a repository operation.
    public let toolName: String
    /// Nil until the member decides.
    public let approved: Bool?
    public let expiresAt: Date?
    /// When the run continued after the decision.
    public let consumedAt: Date?
    /// What the action is about: the search, the page or nothing.
    public let subject: String?

    init?(json: JSONValue) {
        guard let id = json["approvalId"]?.stringValue, !id.isEmpty,
            let tool = json["toolName"]?.stringValue, !tool.isEmpty
        else { return nil }
        approvalID = id
        toolName = json["approvalKind"]?.stringValue == "repository_operation" ? "repository_operation" : tool
        approved = json["approved"]?.boolValue
        expiresAt = json["expiresAt"]?.stringValue.flatMap(TelerAPIClient.parseISO8601)
        consumedAt = json["consumedAt"]?.stringValue.flatMap(TelerAPIClient.parseISO8601)
        let input = json["input"]
        subject = (input?["query"]?.stringValue ?? input?["url"]?.stringValue)?.trimmed
    }
}

/// How a turn is written: the language Teler answers in and the member's
/// time zone, for dates like "yesterday".
public struct TurnLocale: Sendable, Hashable {
    /// The languages the server answers in.
    public static let languages: Set<String> = ["en", "ca", "es", "fr", "it", "de", "pt"]

    public let language: String
    public let timeZone: String?

    /// `language` is a code such as `ca` or `pt-BR`; unsupported ones answer in English.
    public init(language: String, timeZone: TimeZone = .current) {
        let code = String(language.prefix(2)).lowercased()
        self.language = Self.languages.contains(code) ? code : "en"
        let identifier = timeZone.identifier
        let valid = identifier.count <= 64
            && identifier.allSatisfy { $0.isASCII && ($0.isLetter || "_/+-".contains($0)) }
        self.timeZone = valid ? identifier : nil
    }
}

extension String {
    fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
