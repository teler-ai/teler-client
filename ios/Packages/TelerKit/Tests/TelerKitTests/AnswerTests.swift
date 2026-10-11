import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// How answers lay out, what charts decode to, and stopping a turn.
@MainActor @Suite struct AnswerTests {
    private func field(_ json: String) -> ContentField {
        ContentField(json: try! JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
    }

    private let plan = #"""
        {"type":"investigation_plan","schemaVersion":1,"planId":"p","revision":2,"steps":[
          {"id":"step_1","label":"Check the data","activity":"checking-available-data","status":"completed"},
          {"id":"step_2","label":"Explore the data","activity":"exploring-data","status":"in_progress"},
          {"id":"step_3","label":"Prepare the answer","activity":"preparing-answer","status":"pending"}]}
        """#

    @Test func putsWhatEachStepFoundUnderItsStep() {
        let layout = AnswerLayout(content: [
            field(plan),
            field(
                #"{"type":"analysis_activity","activity":"checking-available-data","status":"completed","description":"Found 2.1M orders.","executionTimeMs":6200,"investigationStepId":"step_1"}"#
            ),
            field(#"{"type":"text","text":"Let me compare the quarters."}"#),
            field(
                #"{"type":"analysis_activity","activity":"exploring-data","status":"running","description":"Comparing Q3 with Q2."}"#
            ),
            field(#"{"type":"text","text":"Q3 revenue was **€4.82M**."}"#),
            field(#"{"type":"reasoning","text":"internal"}"#),
            field(#"{"type":"agent_work_receipt","schemaVersion":1}"#),
            field(#"{"type":"quick_actions","actions":[{"label":"By channel","value":"Break it down by channel"}]}"#),
        ])
        #expect(layout.steps.map(\.label) == ["Check the data", "Explore the data", "Prepare the answer"])
        #expect(layout.steps.map(\.findings) == [["Found 2.1M orders."], ["Comparing Q3 with Q2."], []])
        #expect(layout.steps.map(\.seconds) == [6, nil, nil])
        // The narration before the last work is part of the work, not the answer.
        #expect(layout.answer == [.text("Q3 revenue was **€4.82M**.")])
        #expect(layout.isWriting)
        #expect(layout.nextQuestions == [QuickAction(label: "By channel", value: "Break it down by channel")])
    }

    @Test func namesWorkByItsKindWithoutAPlan() {
        let layout = AnswerLayout(content: [
            field(#"{"type":"analysis_activity","activity":"checking-available-data","status":"completed"}"#),
            field(#"{"type":"analysis_activity","activity":"exploring-data","status":"completed","description":"A"}"#),
            field(#"{"type":"analysis_activity","activity":"exploring-data","status":"running","description":"B"}"#),
        ])
        #expect(layout.steps.map(\.kind) == ["checking-available-data", "exploring-data"])
        #expect(layout.steps.map(\.status) == [.completed, .inProgress])
        #expect(layout.steps.last?.findings == ["A", "B"])
        #expect(layout.answer.isEmpty && !layout.isWriting)
    }

    @Test func keepsTheTextWhenWorkFollowsIt() {
        let layout = AnswerLayout(content: [
            field(#"{"type":"text","text":"Churn rose to 2.9%."}"#),
            field(#"{"type":"analysis_activity","activity":"exploring-data","status":"completed"}"#),
        ])
        #expect(layout.answer == [.text("Churn rose to 2.9%.")])
    }

    @Test func readsTheErrorTheTurnEndedWith() {
        let layout = AnswerLayout(content: [
            field(#"{"type":"error","text":"timeout","errorCode":"analysis_timeout"}"#)
        ])
        #expect(layout.error == ContentError(text: "timeout", code: "analysis_timeout"))
    }

    @Test func decodesALineChartIntoSeries() throws {
        let spec = try #require(
            ChartSpec(
                json: try JSONDecoder().decode(
                    JSONValue.self,
                    from: Data(
                        #"""
                        {"version":1,"type":"line","title":"Revenue","config":{"encoding":{"x":"month","y":"revenue","color":"region"}},
                         "data":{"columns":{"month":{"values":["2026-01-01","2026-02-01","2026-01-01"],"dtype":"datetime"},
                          "revenue":{"values":[10,null,7],"dtype":"number"},
                          "region":{"values":["Spain","Spain","France"],"dtype":"string"}}}}
                        """#.utf8))))
        #expect(spec.type == "line")
        #expect(spec.series.map(\.name) == ["Spain", "France"])
        #expect(spec.series.map(\.points.count) == [1, 1])
        guard case .date = spec.series[0].points[0].x else {
            Issue.record("Expected a date on x")
            return
        }
        #expect(ChartSpec(json: .object(["version": .number(2), "type": .string("line")])) == nil)
    }

    @Test func fetchesTheDemoChartsBySlug() async throws {
        let client = TelerAPIClient(
            origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let spec = try await client.chartSpec(chat: chat, slug: "revenue-by-region")
        #expect(spec.series.count == 4)
        await #expect(throws: TelerAPIError.invalidResponse) {
            _ = try await client.chartSpec(chat: chat, slug: "../secrets")
        }
    }

    @Test func asksTheServerToStopTheRunningTurn() async throws {
        let transport = StubTransport([
            .response(status: 200, chunks: [#"{"cancelled":true}"#])
        ])
        let client = TelerAPIClient.stubbed(transport)
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let task = try #require(TaskID(rawValue: "atask_01jcxj18gtpckep6aw4ynnqjmx"))
        #expect(try await client.cancelTask(task, in: chat))
        #expect(transport.requests.first?.method == .post)
        #expect(transport.requests.first?.url.path == "/api/chat/\(chat.rawValue)/task/\(task.rawValue)/cancel")
    }
}
