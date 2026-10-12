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

    static let questionChat = "chat_01jd3a5t9p7n5m3k1h9g7f5d3b"
    static let approvalChat = "chat_01jd3b1d3f5h7k9m1p3r5t7v9x"

    /// Teler's `askUser` call, shown and waiting: header, question, context, options and why.
    static func askUser(
        _ id: String, _ questions: [(String, String, String?, [(String, String)], String)]
    ) -> JSONValue {
        .object([
            "type": .string("tool_call"), "toolName": .string("askUser"), "toolCallId": .string(id),
            "input": .object([
                "questions": .array(
                    questions.map { header, question, context, options, why in
                        var item: [String: JSONValue] = [
                            "header": .string(header), "question": .string(question), "why": .string(why),
                            "options": .array(
                                options.map { .object(["label": .string($0.0), "description": .string($0.1)]) }),
                        ]
                        if let context { item["context"] = .string(context) }
                        return .object(item)
                    })
            ]),
            "output": .object(["status": .string("shown")]),
        ])
    }

    /// A report with sections, a table, a list and a chart in place.
    static let churnReport = """
        Churn rose from **2.1%** to **2.9%** in September, the highest month this year. New monthly subscribers drove most of it.

        ## 1. Where churn rose

        Monthly plans in their first 60 days churned at **6.4%**, up from 3.9% in August. Annual plans held at 0.8%.

        | Plan | August | September | Change |
        |:---|---:|---:|---:|
        | Monthly, first 60 days | 3.9% | 6.4% | +2.5 pt |
        | Monthly, later | 1.7% | 1.9% | +0.2 pt |
        | Annual | 0.8% | 0.8% | 0.0 pt |

        ## 2. What changed

        - Onboarding completion fell from 71% to 58% after the 2 September release.
        - Median support response time doubled to 9 hours in the second half of the month.
        - Prices and plans didn't change.

        ## 3. Revenue at stake

        Revenue still grew in every region but the Nordics, so the churn hasn't shown in totals yet.

        [[artifact:revenue-by-region]]

        ## 4. What to watch in October

        1. Onboarding completion for September's sign-ups.
        2. Support response times once the two new agents start.

        ## Appendix: how we worked it out

        Churn is cancellations divided by subscribers at the start of each month, from the subscriptions table, excluding refunds and test accounts.
        """

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
                id: questionChat, title: "Q3 revenue for the board",
                updatedAt: now.addingTimeInterval(-2 * 60),
                messages: [
                    message(
                        "msg_01jd3a6v0q8k2m5t7w9y1b3c4e", "user",
                        [text("Prepare Q3 revenue for the board deck")], minutesAgo: 3),
                    message(
                        "msg_01jd3a7c2r4t6v8x0z2b4d6f8h", "assistant",
                        [
                            activity(
                                "checking-available-data", step: 1,
                                "Found orders, refunds and the board's Q2 deck figures.", seconds: 9),
                            text("Before I prepare the figures, two choices change the numbers:"),
                            askUser(
                                "call_board_revenue",
                                [
                                    (
                                        "Revenue", "Which revenue should I use for Q3?",
                                        "Refunds were 4.1% of Q3 orders.",
                                        [
                                            ("Net of refunds", "Matches the Q2 board deck."),
                                            ("Gross", "Before refunds and discounts."),
                                        ], "the Q2 deck used net revenue, so the quarters compare."
                                    ),
                                    (
                                        "Currency", "Which currency should the deck use?", nil,
                                        [
                                            ("EUR", "The company's reporting currency."),
                                            ("USD", "At each month's average rate."),
                                            ("Both", "EUR with USD alongside."),
                                        ], "the board reports in euros."
                                    ),
                                ]),
                        ], minutesAgo: 2, seconds: 20),
                ]),
            .init(
                id: approvalChat, title: "Coffee costs against market prices",
                updatedAt: now.addingTimeInterval(-40 * 60),
                messages: [
                    message(
                        "msg_01jd3b2e4g6j8k0n2q4s6v8w0y", "user",
                        [text("Are we paying more for green coffee than the market?")], minutesAgo: 41),
                    message(
                        "msg_01jd3b3f5h7k9m1p3r5t7v9x1z", "assistant",
                        [
                            activity(
                                "checking-available-data", step: 1, "Found 214 purchase orders for green coffee in 2026.",
                                seconds: 7),
                            text("Your average price this year is €6.10 per kilo. To compare it with the market I need current prices."),
                            .object([
                                "type": .string("web_approval"), "approvalId": .string("appr_demo_coffee"),
                                "toolCallId": .string("call_web_coffee"), "toolName": .string("webSearch"),
                                "input": .object(["query": .string("European green coffee prices 2026")]),
                                "expiresAt": .string(timestamp(now.addingTimeInterval(20 * 60))),
                            ]),
                        ], minutesAgo: 40, seconds: 14),
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
                            ),
                            .object([
                                "type": .string("report"), "title": .string("September churn review"),
                                "markdown": .string(churnReport),
                            ]),
                            chart("revenue-by-region", "Monthly revenue by region", type: "line"),
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

    static let executiveDashboard = "dash_01jd2f6y8m3k9q7v5t1w4x0bns"
    static let salesDashboard = "dash_01jd2f9c4h6p2r8z3y5v7n1gqd"

    /// The demo's dashboards, as `GET /api/dashboard` lists them.
    static func dashboardPage(now: Date = Date()) -> JSONValue {
        func summary(_ id: String, _ name: String, _ description: String, minutesAgo: Double, widgets: [String])
            -> JSONValue
        {
            let refreshed = JSONValue.string(timestamp(now.addingTimeInterval(-minutesAgo * 60)))
            return .object([
                "id": .string(id), "name": .string(name), "description": .string(description),
                "organizationId": .string(organization.rawValue), "visibility": .string("organization"),
                "permission": .string("owner"), "lastRefreshedAt": refreshed, "updatedAt": refreshed,
                "widgetCount": .number(Double(widgets.count)),
                "widgetPreviews": .array(
                    widgets.map { .object(["artifactType": .string("metric"), "title": .string($0)]) }),
            ])
        }
        return .object([
            "dashboards": .array([
                summary(
                    executiveDashboard, "Executive overview", "Revenue, orders and churn at a glance",
                    minutesAgo: 5, widgets: ["Headline numbers", "Monthly revenue by region", "Top products", "Revenue by region"]),
                summary(
                    salesDashboard, "Product sales", "What sells, and where", minutesAgo: 62,
                    widgets: ["Top products", "Monthly revenue by region"]),
            ]),
            "hasMore": .bool(false), "nextCursor": .null,
        ])
    }

    /// A demo dashboard's widgets, as `GET /api/dashboard/:id?include=metadata` returns them.
    static func dashboardDetail(_ id: String, now: Date = Date()) -> JSONValue? {
        func widget(_ widgetID: String, _ type: String, _ title: String, x: Int, y: Int, w: Int) -> JSONValue {
            .object([
                "id": .string(widgetID), "dashboardId": .string(id),
                "position": .object(["x": .number(Double(x)), "y": .number(Double(y)), "w": .number(Double(w)), "h": .number(2)]),
                "sortOrder": .number(Double(y * 4 + x)), "config": .object([:]),
                "artifact": .object(["id": .string("art_" + widgetID), "type": .string(type), "title": .string(title)]),
            ])
        }
        let widgets: [JSONValue]
        let name: String
        switch id {
        case executiveDashboard:
            name = "Executive overview"
            widgets = [
                widget("wgt_headline", "metric_grid", "Headline numbers", x: 0, y: 0, w: 4),
                widget("wgt_revenue_month", "line", "Monthly revenue by region", x: 0, y: 1, w: 4),
                widget("wgt_top_products", "bar", "Top products", x: 0, y: 2, w: 4),
                widget("wgt_region_table", "table", "Revenue by region", x: 0, y: 3, w: 4),
            ]
        case salesDashboard:
            name = "Product sales"
            widgets = [
                widget("wgt_top_products", "bar", "Top products", x: 0, y: 0, w: 4),
                widget("wgt_revenue_month", "line", "Monthly revenue by region", x: 0, y: 1, w: 4),
            ]
        default:
            return nil
        }
        let refreshed = JSONValue.string(timestamp(now.addingTimeInterval(-5 * 60)))
        return .object([
            "id": .string(id), "name": .string(name), "description": .null,
            "lastRefreshedAt": refreshed, "refreshInterval": .string("1h"),
            "refresh": .object(["status": .string("ready"), "lastAttemptAt": refreshed]),
            "widgets": .array(widgets),
        ])
    }

    /// A demo widget's data, in Teler's chart format.
    static func widgetSpec(_ widget: String) -> JSONValue? {
        switch widget {
        case "wgt_headline":
            func metric(_ title: String, _ value: String, _ delta: String, _ trend: String) -> JSONValue {
                .object(["title": .string(title), "value": .string(value), "delta": .string(delta), "trend": .string(trend)])
            }
            return .object([
                "version": .number(1), "type": .string("metric_grid"), "title": .string("Headline numbers"),
                "config": .object([:]),
                "data": .object([
                    "metrics": .array([
                        metric("Revenue", "€1.62M", "6.4%", "up"), metric("Orders", "41,380", "3.1%", "up"),
                        metric("Avg order value", "€39.15", "3.2%", "up"),
                        metric("Subscriber churn", "3.4%", "0.7 pt", "down"),
                    ])
                ]),
            ])
        case "wgt_revenue_month":
            return chartSpec("revenue-by-region")
        case "wgt_top_products":
            return chartSpec("top-products")
        case "wgt_region_table":
            func column(_ values: [JSONValue], _ dtype: String) -> JSONValue {
                .object(["values": .array(values), "dtype": .string(dtype)])
            }
            return .object([
                "version": .number(1), "type": .string("table"), "title": .string("Revenue by region"),
                "description": .string("Q3 2026 · EUR"),
                "config": .object(["columns": .array([.string("Region"), .string("Revenue"), .string("Orders")])]),
                "data": .object([
                    "columns": .object([
                        "Region": column(["Iberia", "DACH", "Benelux", "Nordics"].map(JSONValue.string), "string"),
                        "Revenue": column([1_620_000, 1_310_000, 710_000, 560_000].map(JSONValue.number), "number"),
                        "Orders": column([16_210, 12_980, 7_400, 4_790].map(JSONValue.number), "number"),
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
        // The plan changes once, as real plans do: exploring by region gives
        // way to exploring by channel after the first step.
        func revision(_ number: Int, done completed: Int) -> JSONValue {
            let steps: [(String, String)] =
                number == 1
                ? [
                    ("Check the available data", "checking-available-data"),
                    ("Explore the data by region", "exploring-data"),
                    ("Prepare the answer", "preparing-answer"),
                ]
                : [
                    ("Check the available data", "checking-available-data"),
                    ("Explore the data by region", "exploring-data"),
                    ("Explore the data by channel", "exploring-data"),
                    ("Prepare the answer", "preparing-answer"),
                ]
            let live = number == 1 ? [0, 1, 2] : [0, 2, 3]
            return plan(
                "plan_live", revision: number,
                steps.enumerated().map { index, step in
                    guard let position = live.firstIndex(of: index) else { return (step.0, step.1, "superseded") }
                    let status =
                        position < completed ? "completed" : position == completed ? "in_progress" : "pending"
                    return (step.0, step.1, status)
                })
        }
        var script = ScriptBuilder()
        script.add(revision(1, done: 0))
        script.heartbeat()
        script.add(activity("checking-available-data", step: 1, "Found the sample sales tables.", seconds: 3))
        script.add(revision(2, done: 1))
        script.add(activity("exploring-data", step: 3, "Looked at the sample data for your question.", seconds: 9))
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
