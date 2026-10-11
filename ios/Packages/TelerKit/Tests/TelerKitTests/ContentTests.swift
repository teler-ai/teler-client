import Foundation
import Testing

@testable import TelerKit

@Suite struct ContentFieldTests {
    private func decode(_ json: String) throws -> [ContentField] {
        try JSONDecoder().decode([ContentField].self, from: Data(json.utf8))
    }

    @Test func decodesTheNativelyRenderedParts() throws {
        let fields = try decode(
            """
            [{"type":"text","text":"Hi"},
             {"type":"report","title":"Q3","markdown":"# Q3"},
             {"type":"reasoning","text":"Comparing"},
             {"type":"error","text":"Failed","code":"TURN_FAILED"}]
            """)
        #expect(
            fields == [
                .text("Hi"), .report(title: "Q3", markdown: "# Q3"), .reasoning("Comparing"),
                .error(ContentError(text: "Failed", code: "TURN_FAILED")),
            ])
    }

    @Test func decodesAnInvestigationPlan() throws {
        let fields = try decode(
            """
            [{"type":"investigation_plan","schemaVersion":1,"planId":"p1","revision":2,
              "steps":[{"id":"step_1","label":"Check data","activity":"checking-available-data","status":"in_progress"},
                       {"id":"step_2","label":"Answer","activity":"preparing-answer","status":"later"}]}]
            """)
        guard case .investigationPlan(let plan) = fields.first else {
            Issue.record("Expected a plan")
            return
        }
        #expect(plan.planID == "p1" && plan.revision == 2)
        #expect(plan.steps.map(\.status) == [.inProgress, .unknown])
    }

    @Test func keepsUnknownAndChangedPartsAsTheirOriginalJSON() throws {
        let fields = try decode(
            """
            [{"type":"chart_artifact","slug":"top"},
             {"type":"text","text":42},
             {"type":"investigation_plan","schemaVersion":2},
             {"no":"type"}]
            """)
        #expect(fields.map(\.type) == ["chart_artifact", "text", "investigation_plan", ""])
        for field in fields {
            guard case .unknown = field else {
                Issue.record("Expected .unknown, got \(field)")
                continue
            }
        }
    }

    @Test func readsAPlainStringUserMessage() throws {
        let message = try JSONDecoder().decode(
            ChatMessage.self,
            from: Data(#"{"id":"msg_01jccwkk02xywzpd6wmh3dkkg1","role":"user","content":"Hello"}"#.utf8))
        #expect(message.content == [.text("Hello")])
        #expect(message.role == .user)
    }
}

@Suite struct ContentMergeTests {
    private func plan(_ revision: Int) -> ContentField {
        .investigationPlan(InvestigationPlan(planID: "p", revision: revision, steps: []))
    }

    @Test func appendsATextSuffixToTheLastPart() {
        let merged = ContentMerge.append([.text(" world"), .reasoning("next")], to: [.text("Hello")])
        #expect(merged == [.text("Hello world"), .reasoning("next")])
    }

    @Test func appendsAnUntitledReportSuffix() {
        let merged = ContentMerge.append(
            [.report(title: "", markdown: " more")], to: [.report(title: "Q3", markdown: "Start")])
        #expect(merged == [.report(title: "Q3", markdown: "Start more")])
    }

    @Test func startsANewReportWhenTheTitleIsSet() {
        let merged = ContentMerge.append(
            [.report(title: "Q4", markdown: "B")], to: [.report(title: "Q3", markdown: "A")])
        #expect(merged.count == 2)
    }

    @Test func keepsTheNewestPlanRevisionInItsFirstPosition() {
        let merged = ContentMerge.append([plan(3), .text("done")], to: [plan(1), .text("a"), plan(2)])
        #expect(merged == [plan(3), .text("a"), .text("done")])
    }

    @Test func ignoresAnEmptyUpdate() {
        #expect(ContentMerge.append([], to: [.text("a")]) == [.text("a")])
    }
}
