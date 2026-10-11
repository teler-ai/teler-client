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

    /// What Teler did for one step, in plain words.
    static func activity(_ kind: String, step: Int, _ description: String, seconds: Double) -> JSONValue {
        .object([
            "type": .string("analysis_activity"), "activity": .string(kind), "status": .string("completed"),
            "origin": .string("code_execution"), "description": .string(description),
            "executionTimeMs": .number(seconds * 1000), "investigationStepId": .string("step_\(step)"),
        ])
    }

    static func chart(_ slug: String, _ title: String, type: String) -> JSONValue {
        .object([
            "type": .string("chart_artifact"), "slug": .string(slug), "chartType": .string(type),
            "title": .string(title),
        ])
    }

    static func quickActions(_ questions: [String]) -> JSONValue {
        .object([
            "type": .string("quick_actions"),
            "actions": .array(questions.map { .object(["label": .string($0), "value": .string($0)]) }),
        ])
    }

    static func chats(now: Date = Date()) -> [DemoState.Chat] {
        /// An answer took `seconds` to write, so it was created that long before it completed.
        func message(
            _ id: String, _ role: String, _ content: [JSONValue], minutesAgo: Double, seconds: Double = 0
        ) -> DemoState.Message {
            let date = now.addingTimeInterval(-minutesAgo * 60)
            return .init(
                id: id, role: role, content: content, createdAt: date.addingTimeInterval(-seconds),
                completedAt: date)
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
                            activity(
                                "checking-available-data", step: 1,
                                "Found orders, regions and refunds: 2.1M orders since 2024.", seconds: 6),
                            activity(
                                "exploring-data", step: 2,
                                "Compared Q3 with Q2 for 4 regions. The Nordics dip came from two renewals.",
                                seconds: 31),
                            activity(
                                "preparing-answer", step: 3, "Wrote the answer and a chart of monthly revenue.",
                                seconds: 8),
                            text(
                                "Revenue rose **8.4%** quarter over quarter, to €4.2M.\n\n- **Iberia** led the growth (+15%), driven by new retail accounts.\n- **DACH** was flat (+0.6%).\n- **Nordics** fell 3% after two large renewals moved to Q4.\n\n[[artifact:revenue-by-region]]\n\n| Region | Q3 | vs Q2 |\n|:---|---:|---:|\n| Iberia | €1.62M | +15.0% |\n| DACH | €1.31M | +0.6% |\n| Benelux | €0.71M | +9.8% |\n| Nordics | €0.56M | −3.0% |"
                            ),
                            chart("revenue-by-region", "Monthly revenue by region", type: "line"),
                            quickActions(["Break it down by channel", "Why did the Nordics dip?", "Forecast Q4"]),
                        ], minutesAgo: 25, seconds: 48),
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
                            chart("top-products", "Top products by revenue", type: "bar"),
                            text("**Loom Desk Lamp** is first for the third week in a row."),
                        ], minutesAgo: 1560),
                ]),
        ]
    }

    /// The demo's charts, in Teler's chart format, by slug.
    static func chartSpec(_ slug: String) -> JSONValue? {
        func column(_ values: [JSONValue], _ dtype: String) -> JSONValue {
            .object(["values": .array(values), "dtype": .string(dtype)])
        }
        switch slug {
        case "revenue-by-region":
            let months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01",
                "2026-07-01", "2026-08-01", "2026-09-01"]
            let regions: [(String, [Double])] = [
                ("Iberia", [410, 425, 440, 455, 470, 488, 512, 530, 578]),
                ("DACH", [430, 428, 432, 436, 434, 438, 437, 436, 437]),
                ("Benelux", [205, 210, 214, 218, 221, 226, 232, 236, 242]),
                ("Nordics", [190, 192, 195, 196, 198, 199, 190, 186, 184]),
            ]
            var month: [JSONValue] = []
            var region: [JSONValue] = []
            var revenue: [JSONValue] = []
            for (name, values) in regions {
                for (index, value) in values.enumerated() {
                    month.append(.string(months[index]))
                    region.append(.string(name))
                    revenue.append(.number(value * 1000))
                }
            }
            return .object([
                "version": .number(1), "type": .string("line"), "title": .string("Monthly revenue by region"),
                "description": .string("Jan–Sep 2026 · EUR"),
                "config": .object([
                    "encoding": .object(["x": .string("month"), "y": .string("revenue"), "color": .string("region")])
                ]),
                "data": .object([
                    "columns": .object([
                        "month": column(month, "datetime"), "region": column(region, "string"),
                        "revenue": column(revenue, "number"),
                    ])
                ]),
            ])
        case "top-products":
            let products: [(String, Double)] = [
                ("Loom Desk Lamp", 48_200), ("Weft Throw", 31_900), ("Warp Stool", 27_400),
                ("Shuttle Mug", 19_800), ("Bobbin Planter", 15_100),
            ]
            return .object([
                "version": .number(1), "type": .string("bar"), "title": .string("Top products by revenue"),
                "description": .string("This week · EUR"),
                "config": .object([
                    "encoding": .object([
                        "x": .string("product"), "y": .string("revenue"), "horizontal": .bool(true),
                    ])
                ]),
                "data": .object([
                    "columns": .object([
                        "product": column(products.map { .string($0.0) }, "string"),
                        "revenue": column(products.map { .number($0.1) }, "number"),
                    ])
                ]),
            ])
        default:
            return nil
        }
    }

    /// The questions a new chat offers, as the server writes them for an organization's tables.
    static let starterPrompts = [
        "Which region grew fastest last quarter?",
        "How has churn changed over the last 6 months?",
        "What are this week's top products by revenue?",
    ]

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
        script.add(activity("checking-available-data", step: 1, "Found the sample sales tables.", seconds: 3))
        script.add(revision(2, done: 1))
        script.add(activity("exploring-data", step: 2, "Looked at the sample data for your question.", seconds: 9))
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
