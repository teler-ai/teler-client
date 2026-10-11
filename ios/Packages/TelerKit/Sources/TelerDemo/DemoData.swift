import Foundation
import TelerKit

/// Sample chats for the demo mode. The numbers are invented.
public enum DemoData {
    public static let origin = try! TelerOrigin("https://app.teler.example")
    public static let organization = OrganizationID(rawValue: "org_01jczpznh32py20pd8y10ef9cq")!

    private static let alphabet = Array("0123456789abcdefghjkmnpqrstvwxyz")

    static func newID(_ prefix: String) -> String {
        prefix + "_" + String((0..<26).map { _ in alphabet.randomElement()! })
    }

    static func timestamp(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    static func text(_ value: String) -> JSONValue {
        .object(["type": .string("text"), "text": .string(value)])
    }

    static func plan(_ id: String, revision: Int, _ steps: [(String, String, String)]) -> JSONValue {
        .object([
            "type": .string("investigation_plan"), "schemaVersion": .number(1),
            "planId": .string(id), "revision": .number(Double(revision)),
            "steps": .array(
                steps.enumerated().map { index, step in
                    .object([
                        "id": .string("step_\(index + 1)"), "label": .string(step.0),
                        "activity": .string(step.1), "status": .string(step.2),
                    ])
                }),
        ])
    }

    static func chats(now: Date = Date()) -> [DemoState.Chat] {
        func message(_ id: String, _ role: String, _ content: [JSONValue], minutesAgo: Double)
            -> DemoState.Message
        {
            let date = now.addingTimeInterval(-minutesAgo * 60)
            return .init(id: id, role: role, content: content, createdAt: date, completedAt: date)
        }
        return [
            .init(
                id: "chat_01jcxj18gtpckep6aw4ynnqjmx", title: "Quarterly revenue by region",
                updatedAt: now.addingTimeInterval(-25 * 60),
                messages: [
                    message(
                        "msg_01jccwkk02xywzpd6wmh3dkkg1", "user",
                        [text("How did revenue change by region last quarter?")], minutesAgo: 26),
                    message(
                        "msg_01jcd0zq1kmn3pyt8rq9w9g4ys", "assistant",
                        [
                            plan(
                                "plan_revenue", revision: 3,
                                [
                                    ("Check the sales tables", "checking-available-data", "completed"),
                                    ("Compare Q3 with Q2 by region", "exploring-data", "completed"),
                                    ("Summarize the changes", "preparing-answer", "completed"),
                                ]),
                            text(
                                "Revenue rose **8.4%** quarter over quarter, to €4.2M.\n\n- **Iberia** led the growth (+15%), driven by new retail accounts.\n- **DACH** was flat (+0.6%).\n- **Nordics** fell 3% after two large renewals moved to Q4."
                            ),
                        ], minutesAgo: 25),
                ]),
            .init(
                id: "chat_01jcee37e1fsbpkjgmdsqtg64p", title: "Why did churn rise in September?",
                updatedAt: now.addingTimeInterval(-3 * 60 * 60),
                messages: [
                    message(
                        "msg_01jcqzxnma5wt8fy0a5bg5kbhb", "user",
                        [text("Why did churn rise in September?")], minutesAgo: 181),
                    message(
                        "msg_01jc16nd52hdcnye1jnwxms5pf", "assistant",
                        [
                            text(
                                "Churn rose from 2.1% to 2.9% in September. Most of the increase came from **monthly plans in their first 60 days**:\n\n1. Onboarding completion dropped after the 2 September release.\n2. Support response times doubled in the second half of the month.\n\nAnnual plans were stable."
                            )
                        ], minutesAgo: 180),
                ]),
            .init(
                id: "chat_01jcy4dmhbx6tnc0rz7n9nwq0s", title: "Top products this week",
                updatedAt: now.addingTimeInterval(-26 * 60 * 60),
                messages: [
                    message(
                        "msg_01jctthvmxdgt2cxs9b3kgvrjj", "user",
                        [text("Which products sold best this week?")], minutesAgo: 1561),
                    message(
                        "msg_01jctw2vpe1zw19m2by1fxz0p5", "assistant",
                        [
                            text("The top three products made 41% of this week's sales."),
                            .object([
                                "type": .string("chart_artifact"), "slug": .string("top-products"),
                                "title": .string("Top products by revenue"),
                            ]),
                            text("**Loom Desk Lamp** is first for the third week in a row."),
                        ], minutesAgo: 1560),
                ]),
        ]
    }

    /// The streamed answer to any new question in demo mode.
    static func liveAnswer(to question: String) -> ScriptBuilder {
        let steps = ["Check the available data", "Explore the data", "Prepare the answer"]
        let activities = ["checking-available-data", "exploring-data", "preparing-answer"]
        func revision(_ number: Int, done completed: Int) -> JSONValue {
            plan(
                "plan_live", revision: number,
                (0..<3).map { index in
                    let status =
                        index < completed ? "completed" : index == completed ? "in_progress" : "pending"
                    return (steps[index], activities[index], status)
                })
        }
        var script = ScriptBuilder()
        script.add(revision(1, done: 0))
        script.heartbeat()
        script.add(revision(2, done: 1))
        script.add(revision(3, done: 2))
        let quoted = question.count > 120 ? String(question.prefix(119)) + "…" : question
        let answer =
            "This is demo mode, so this answer is a sample. With your workspace connected, Teler would query your data for “\(quoted)” and answer with numbers, charts and the steps it took.\n\nOpen the sample chats to see finished answers."
        let words = answer.split(separator: " ", omittingEmptySubsequences: false)
        for (index, chunk) in stride(from: 0, to: words.count, by: 4).enumerated() {
            let piece = words[chunk..<min(chunk + 4, words.count)].joined(separator: " ")
            if index == 0 {
                script.add(text(piece))
            } else {
                script.extendText(" " + piece)
            }
        }
        script.add(revision(4, done: 3))
        script.finish()
        return script
    }
}
