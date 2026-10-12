import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// Teler's questions: what arrives, what's waiting, and how answers go back.
@MainActor @Suite struct QuestionTests {
    private func field(_ json: String) -> ContentField {
        ContentField(json: try! JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
    }

    private let call = #"""
        {"type":"tool_call","toolName":"askUser","toolCallId":"call_1","output":{"status":"shown"},
         "input":{"questions":[
          {"header":"Revenue","question":"Which revenue should I use?","why":"the Q2 deck used it.",
           "options":[{"label":"Net of refunds","description":"Matches Q2."},{"label":"Gross","description":""}]},
          {"header":"Currency","question":"Which currency?","why":"the board reports in euros.",
           "options":[{"label":"EUR","description":""},{"label":"USD","description":""}]}]}}
        """#

    private func question() throws -> AskUserCall {
        guard case .question(let call) = field(call) else { throw TestFailure.unexpected }
        return call
    }

    private enum TestFailure: Error { case unexpected }

    private func demo() -> TelerAPIClient {
        TelerAPIClient(
            origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
    }

    // MARK: Parts

    @Test func readsQuestionsAnswersAndApprovals() throws {
        let call = try question()
        #expect(call.toolCallID == "call_1")
        #expect(call.status == .shown)
        #expect(call.questions.map(\.header) == ["Revenue", "Currency"])
        #expect(call.questions[0].options[0].label == "Net of refunds")

        let oneOption = field(
            #"{"type":"tool_call","toolName":"askUser","toolCallId":"c","input":{"questions":[{"header":"A","question":"B","why":"C","options":[{"label":"x","description":""}]}]}}"#)
        #expect(oneOption.type == "tool_call")
        #expect(ContentField.hiddenTypes.contains(oneOption.type))

        guard
            case .questionAnswers(let receipt) = field(
                #"{"type":"question_answers","schemaVersion":1,"toolCallId":"call_1","source":"user","answers":[{"header":"Revenue","question":"Which revenue should I use?","answer":"Gross","kind":"option","recommended":false}]}"#)
        else { throw TestFailure.unexpected }
        #expect(receipt.answers.first?.answer == "Gross")

        guard
            case .approval(let approval) = field(
                #"{"type":"web_approval","approvalId":"appr_1","toolCallId":"t","toolName":"webSearch","input":{"query":"coffee prices"},"expiresAt":"2026-10-12T10:00:00.000Z"}"#)
        else { throw TestFailure.unexpected }
        #expect(approval.subject == "coffee prices")
        #expect(approval.approved == nil)
        #expect(approval.expiresAt != nil)
    }

    // MARK: Answer text

    @Test func writesTheAnswersTheModelReads() throws {
        let call = try question()
        let answers = QuestionAnswers(
            toolCallId: call.toolCallID, source: .user,
            answers: [
                QuestionAnswer(call.questions[0], option: 0),
                QuestionAnswer(call.questions[1], ownWords: "Euros, with dollars in a footnote"),
            ])
        #expect(
            answers.text == """
                Answers to your questions:
                - Which revenue should I use? → Net of refunds (your recommendation)
                - Which currency? → Euros, with dollars in a footnote (in my own words)
                """)
        let auto = QuestionAnswers(toolCallId: "c", source: .auto, answers: [QuestionAnswer(call.questions[1], option: 1)])
        #expect(auto.text == "No answer in 30 seconds, so go with your recommended answers:\n- Which currency? → USD")
    }

    @Test func cutsTypedAnswersThatWouldOverflowOneMessage() throws {
        let call = try question()
        let long = String(repeating: "a", count: 5000)
        let answers = QuestionAnswers(
            toolCallId: "c", source: .user,
            answers: [
                QuestionAnswer(call.questions[0], ownWords: "short"),
                QuestionAnswer(call.questions[1], ownWords: long),
            ])
        #expect(answers.text.utf16.count <= QuestionAnswers.textLimit)
        #expect(answers.text.contains("short"))
        #expect(answers.text.contains("…"))
        #expect(answers.clamped.answers[1].answer.utf16.count == 2000)
        #expect(QuestionAnswers.clamp("ab😀cd", 4) == "ab…")
    }

    // MARK: Answering one at a time

    @Test func stepsThroughTheQuestions() throws {
        var flow = QuestionFlow(call: try question(), isLive: true)
        #expect(flow.countsDown)
        let first = flow.pick(1)
        #expect(first == nil)
        #expect(!flow.countsDown)
        #expect(flow.counts.current == 2)
        flow.back()
        #expect(flow.question.header == "Revenue")
        #expect(flow.withPicks.map(\.answer) == ["Gross", "EUR"])
        let again = flow.pick(0)
        #expect(again == nil)
        let last = flow.pick(0)
        let complete = try #require(last)
        #expect(complete.map(\.answer) == ["Net of refunds", "EUR"])
        #expect(complete.map(\.recommended) == [true, true])
        #expect(!QuestionFlow(call: try question(), isLive: false).countsDown)
    }

    @Test func knowsWhichQuestionsWait() throws {
        var count = 0
        func message(_ role: MessageRole, _ content: [ContentField]) -> ChatMessage {
            count += 1
            let id = MessageID(rawValue: "msg_01jcxj18gtpckep6aw4ynn" + String(format: "%04d", count))!
            return ChatMessage(id: id, role: role, content: content)
        }
        let asked = [message(.user, [.text("Q3 for the board")]), message(.assistant, [field(call)])]
        #expect(asked.pendingQuestion()?.toolCallID == "call_1")
        #expect(asked.questionStatuses()["call_1"] == .waiting)

        let receipt = QuestionAnswers(toolCallId: "call_1", source: .user, answers: [])
        let answered = asked + [message(.user, [.text("Answers"), .questionAnswers(receipt)])]
        #expect(answered.pendingQuestion() == nil)
        #expect(answered.questionStatuses()["call_1"] == .answered)

        let movedOn = asked + [message(.user, [.text("Something else")])]
        #expect(movedOn.pendingQuestion() == nil)
        #expect(movedOn.questionStatuses()["call_1"] == .notAnswered)
    }

    // MARK: Sending

    @Test func answersAndShowsTheReceipt() async throws {
        let chat = try #require(ChatID(rawValue: DemoData.questionChat))
        let model = ConversationModel(chat: chat, client: demo(), language: "ca")
        await model.load()
        let flow = try #require(model.questionFlow)
        #expect(!flow.isLive)
        #expect(flow.call.questions.count == 2)

        await model.pick(0)
        #expect(model.questionFlow?.counts.current == 2)
        model.draft = "Both, euros first"
        await model.answerInOwnWords()
        await model.streamTask?.value

        #expect(model.questionFlow == nil)
        #expect(model.answerSending == nil)
        let sent = try #require(model.items.last(where: { $0.role == .user }))
        guard case .questionAnswers(let receipt)? = sent.content.last else { throw TestFailure.unexpected }
        #expect(receipt.answers.map(\.kind) == [.option, .text])
        #expect(model.questionStatuses.values.contains(.answered))
    }

    @Test func sendsTheLanguageTimeZoneAndReceipt() async throws {
        let transport = StubTransport([
            .response(status: 202, chunks: [#"{"taskId":"atask_01jcxj18gtpckep6aw4ynnqjmx","messageId":"msg_01jcxj18gtpckep6aw4ynnqjmx"}"#])
        ])
        let client = TelerAPIClient.stubbed(transport)
        let chat = try #require(ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx"))
        let receipt = QuestionAnswers(
            toolCallId: "call_1", source: .user, answers: [QuestionAnswer(try question().questions[0], option: 0)])
        _ = try await client.sendMessage(
            receipt.text, to: chat,
            locale: TurnLocale(language: "pt-BR", timeZone: TimeZone(identifier: "Europe/Madrid")!), answers: receipt)
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(transport.requests.first?.body))
        #expect(body["language"]?.stringValue == "pt")
        #expect(body["timeZone"]?.stringValue == "Europe/Madrid")
        #expect(body["questionAnswers"]?["answers"]?.arrayValue?.first?["recommended"]?.boolValue == true)
        #expect(TurnLocale(language: "ja").language == "en")
    }
}
