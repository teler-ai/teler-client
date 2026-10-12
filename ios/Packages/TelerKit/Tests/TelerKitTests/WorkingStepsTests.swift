import Foundation
import Testing

@testable import TelerFeatures
@testable import TelerKit

/// Working steps that stay honest: a dropped stream reconnects, and a changed plan keeps its earlier steps.
@MainActor @Suite struct WorkingStepsTests {
    private let chat = "chat_01jcxj18gtpckep6aw4ynnqjmx"
    private let task = "atask_01jcxj18gtpckep6aw4ynnqjmx"
    private let message = "msg_01jcxj18gtpckep6aw4ynnqjmx"

    private func detail(running: Bool) -> String {
        let active = running ? #","activeAgentTask":{"id":"\#(task)","messageId":"\#(message)","status":"running"}"# : ""
        return #"""
            {"id":"\#(chat)","title":"Revenue","messages":[
              {"id":"msg_01jcxj18gtpckep6aw4ynnqjm0","role":"user","content":[{"type":"text","text":"How did revenue do?"}]},
              {"id":"\#(message)","role":"assistant","content":[]}]\#(active)}
            """#
    }

    private func event(_ json: String, id: Int) -> String {
        "event: content\nid: \(id)\ndata: \(json)\n\n"
    }

    @Test func reconnectsAfterTheStreamDropsAndShowsWhenItWill() async throws {
        let transport = StubTransport([
            .response(status: 200, chunks: [detail(running: true)]),
            .failure,
            .response(
                status: 200,
                chunks: [
                    event(#"{"fields":[{"type":"text","text":"Revenue rose."}],"done":true}"#, id: 1)
                ]),
            .response(status: 200, chunks: [detail(running: false)]),
        ])
        let model = ConversationModel(chat: ChatID(rawValue: chat)!, client: .stubbed(transport))
        model.streamPolicy = ReconnectPolicy(delays: [])
        model.reconnectDelays = [.milliseconds(300)]
        await model.load()
        // The first stream fails at once; the chat waits before reconnecting.
        try await Task.sleep(for: .milliseconds(100))
        guard case .reconnecting(let at) = model.connection else {
            Issue.record("Expected reconnecting, got \(model.connection)")
            return
        }
        #expect(at > Date())
        model.retryNow()
        await model.streamTask?.value
        #expect(model.connection == .live)
        #expect(model.streamProblem == nil)
        #expect(transport.requests.filter { $0.url.path.hasSuffix("/stream") }.count == 2)
    }

    @Test func keepsTheStepsAPlanReplaced() {
        func field(_ json: String) -> ContentField {
            ContentField(json: try! JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
        }
        let layout = AnswerLayout(content: [
            field(
                #"""
                {"type":"investigation_plan","schemaVersion":1,"planId":"p","revision":3,"steps":[
                  {"id":"s1","label":"Check the data","activity":"checking-available-data","status":"completed"},
                  {"id":"s2","label":"Explore by region","activity":"exploring-data","status":"superseded"},
                  {"id":"s3","label":"Explore by channel","activity":"exploring-data","status":"in_progress"}]}
                """#),
            field(#"{"type":"analysis_activity","activity":"exploring-data","status":"retrying","investigationStepId":"s3"}"#),
        ])
        #expect(layout.steps.map(\.id) == ["s1", "s3"])
        #expect(layout.replacedSteps.map(\.label) == ["Explore by region"])
        #expect(layout.steps.last?.isRetrying == true)
    }
}
