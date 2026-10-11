import Foundation
import TelerKit

/// How an assistant message lays out: the steps Teler worked through, in plain
/// words, then the answer, then questions to ask next.
public struct AnswerLayout: Sendable, Equatable {
    public struct Step: Sendable, Equatable, Identifiable {
        public let id: String
        /// The plan's words for the step. Without a plan it's nil and `kind`
        /// says what the work was, for the app to name.
        public let label: String?
        public let kind: String?
        public let status: InvestigationPlan.Status
        /// What the step found, as Teler described it.
        public let findings: [String]
        /// How long the step's work ran, when Teler reported it.
        public let seconds: Int?
    }

    public let steps: [Step]
    /// The answer's parts, without the work behind it.
    public let answer: [ContentField]
    public let nextQuestions: [QuickAction]
    /// The error the turn ended with, if it did.
    public let error: ContentError?

    public init(content: [ContentField]) {
        var plan: InvestigationPlan?
        var activities: [AnalysisActivity] = []
        var lastWork = -1
        var questions: [QuickAction] = []
        var error: ContentError?
        for (index, field) in content.enumerated() {
            switch field {
            case .investigationPlan(let latest): plan = latest
            case .activity(let activity):
                activities.append(activity)
                lastWork = index
            case .quickActions(let actions): questions = actions
            case .error(let failure): error = failure
            default: break
            }
        }
        steps = plan.map { Self.steps(plan: $0, activities: activities) } ?? Self.steps(activities: activities)
        nextQuestions = questions
        self.error = error

        // Text written before the last piece of work narrates the work; the
        // answer is what comes after it, as on the web.
        var answer: [ContentField] = []
        for (index, field) in content.enumerated() {
            switch field {
            case .investigationPlan, .activity, .quickActions, .error, .reasoning: continue
            case .text where index < lastWork: continue
            case .unknown(let type, _) where ContentField.hiddenTypes.contains(type): continue
            default: answer.append(field)
            }
        }
        if !answer.contains(where: { if case .text = $0 { true } else { false } }),
            let lastText = content.prefix(max(lastWork, 0)).last(where: {
                if case .text = $0 { true } else { false }
            })
        {
            answer.insert(lastText, at: 0)
        }
        self.answer = answer
    }

    /// True while the answer's own text is being written.
    public var isWriting: Bool {
        answer.contains { if case .text(let text) = $0 { !text.isEmpty } else { false } }
    }

    private static func steps(plan: InvestigationPlan, activities: [AnalysisActivity]) -> [Step] {
        let planned = Set(plan.steps.map(\.id))
        let running = plan.steps.first { $0.status == .inProgress }?.id
        var found: [String: [AnalysisActivity]] = [:]
        for activity in activities {
            // Work that names no step of this plan belongs to the step under way.
            guard let step = activity.planStepID.flatMap({ planned.contains($0) ? $0 : nil }) ?? running else {
                continue
            }
            found[step, default: []].append(activity)
        }
        return plan.steps.filter { $0.status != .superseded }.map { step in
            let work = found[step.id] ?? []
            return Step(
                id: step.id, label: step.label, kind: step.activity, status: step.status,
                findings: findings(work), seconds: seconds(work))
        }
    }

    /// Without a plan, consecutive work of one kind is one step.
    private static func steps(activities: [AnalysisActivity]) -> [Step] {
        var groups: [(kind: String, work: [AnalysisActivity])] = []
        for activity in activities {
            if groups.last?.kind == activity.kind {
                groups[groups.count - 1].work.append(activity)
            } else {
                groups.append((activity.kind, [activity]))
            }
        }
        return groups.enumerated().map { index, group in
            let running = group.work.last?.status == "running" || group.work.last?.status == "retrying"
            return Step(
                id: "work_\(index)", label: nil, kind: group.kind,
                status: running ? .inProgress : .completed, findings: findings(group.work),
                seconds: seconds(group.work))
        }
    }

    private static func findings(_ work: [AnalysisActivity]) -> [String] {
        var seen = Set<String>()
        return work.compactMap { $0.description?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    private static func seconds(_ work: [AnalysisActivity]) -> Int? {
        let total = work.compactMap(\.milliseconds).reduce(0, +)
        return total > 0 ? max(1, total / 1000) : nil
    }
}
