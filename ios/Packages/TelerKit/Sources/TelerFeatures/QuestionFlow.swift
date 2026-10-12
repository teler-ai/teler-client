import Foundation
import TelerKit

/// Answering Teler's questions one at a time: pick an option or answer in
/// your own words, go back, or take Teler's picks for the rest.
public struct QuestionFlow: Equatable, Sendable {
    public let call: AskUserCall
    /// The questions arrived while this chat was open, so Teler's picks go
    /// out by themselves after 30 seconds untouched, as on the web.
    public let isLive: Bool
    public private(set) var step = 0
    public private(set) var answers: [QuestionAnswer?]
    /// Any interaction stops the countdown to Teler's picks.
    public private(set) var touched = false

    public static let autoAnswerSeconds = 30

    public init(call: AskUserCall, isLive: Bool) {
        self.call = call
        self.isLive = isLive
        answers = Array(repeating: nil, count: call.questions.count)
    }

    public var question: AskUserQuestion { call.questions[step] }
    public var counts: (current: Int, total: Int) { (step + 1, call.questions.count) }
    public var countsDown: Bool { isLive && !touched && step == 0 }

    /// Records an answer to the current question. Returns every answer when
    /// that was the last question, otherwise moves to the next one.
    public mutating func record(_ answer: QuestionAnswer) -> [QuestionAnswer]? {
        touched = true
        answers[step] = answer
        if let next = answers.firstIndex(where: { $0 == nil }) {
            step = next
            return nil
        }
        return answers.compactMap { $0 }
    }

    public mutating func pick(_ option: Int) -> [QuestionAnswer]? {
        record(QuestionAnswer(question, option: option))
    }

    public mutating func back() {
        touched = true
        step = max(0, step - 1)
    }

    public mutating func touch() {
        touched = true
    }

    /// The answers so far, with Teler's pick for every question left.
    public var withPicks: [QuestionAnswer] {
        call.questions.indices.map { answers[$0] ?? QuestionAnswer(call.questions[$0], option: 0) }
    }
}

/// Where a question stands in the transcript.
public enum QuestionStatus: Sendable, Hashable {
    /// The latest turn ends with it and nobody has answered.
    case waiting
    case answered
    /// The conversation moved on without an answer.
    case notAnswered
    /// Teler answered it with its own picks, as in a scheduled run.
    case auto
}

extension Array where Element == ChatMessage {
    /// The questions waiting for an answer: the last valid shown call after the
    /// member's last message without answers on record (`ask-user-selector.ts`).
    func pendingQuestion() -> AskUserCall? {
        let answered = answeredQuestionIDs
        let lastUser = lastIndex { $0.role == .user } ?? -1
        var pending: AskUserCall?
        for message in self[(lastUser + 1)...] where message.role == .assistant {
            for field in message.content {
                if case .question(let call) = field, call.status == .shown, !answered.contains(call.toolCallID) {
                    pending = call
                }
            }
        }
        return pending
    }

    /// Every question's status, by tool call.
    func questionStatuses() -> [String: QuestionStatus] {
        let answered = answeredQuestionIDs
        let lastUser = lastIndex { $0.role == .user } ?? -1
        var statuses: [String: QuestionStatus] = [:]
        for (index, message) in enumerated() where message.role == .assistant {
            for field in message.content {
                guard case .question(let call) = field else { continue }
                statuses[call.toolCallID] =
                    answered.contains(call.toolCallID) ? .answered
                    : call.status == .auto ? .auto
                    : index > lastUser ? .waiting : .notAnswered
            }
        }
        return statuses
    }

    private var answeredQuestionIDs: Set<String> {
        var ids = Set<String>()
        for message in self where message.role == .user {
            for field in message.content {
                if case .questionAnswers(let answers) = field { ids.insert(answers.toolCallId) }
            }
        }
        return ids
    }
}
