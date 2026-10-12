import Foundation
import Testing

@testable import TelerDemo
@testable import TelerFeatures
@testable import TelerKit

/// Attaching files: the web's rules, uploading in parts, and sending them with a question.
@MainActor @Suite struct AttachmentTests {
    private func demo() -> TelerAPIClient {
        TelerAPIClient(
            origin: DemoData.origin, identity: ClientIdentity(name: "teler-ios", version: "0.1.0")!,
            transport: DemoTransport(chunkDelay: .zero))
    }

    private func file(_ name: String, _ text: String) throws -> PickedFile {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(name)
        try Data(text.utf8).write(to: url)
        return PickedFile(url: url, name: name, size: Int64(text.utf8.count), contentType: "text/csv")
    }

    @Test func checksFilesLikeTheWeb() {
        #expect(UploadRules.kind(of: "Orders.CSV") == .data)
        #expect(UploadRules.kind(of: "backup.tar.gz") == .archive)
        #expect(UploadRules.refusal(name: "old.xls", size: 10) == .legacyExcel)
        #expect(UploadRules.refusal(name: "notes.key", size: 10) == .unsupported)
        #expect(UploadRules.refusal(name: "empty.csv", size: 0) == .empty)
        #expect(UploadRules.refusal(name: "scan.pdf", size: 51 * 1024 * 1024) == .tooLarge(limit: 50 * 1024 * 1024))
        #expect(UploadRules.refusal(name: "big.parquet", size: 9 * 1024 * 1024 * 1024) == nil)
        #expect(AttachmentTray.numbered("orders.csv", 2) == "orders (2).csv")
        #expect(AttachmentTray.numbered("logs.tar.gz", 3) == "logs (3).tar.gz")
        #expect(AttachmentTray.safeName(" a/b:c.csv ") == "a-b-c.csv")
    }

    @Test func uploadsAFileAndSendsItWithTheQuestion() async throws {
        let client = demo()
        let organization = try #require(try await client.activeOrganization())
        let chat = try await client.createChat(in: organization)
        let model = ConversationModel(chat: chat, client: client)
        model.attachments.pollInterval = .zero
        await model.load()

        model.attachments.add(try file("orders.csv", "region,revenue\nIberia,410\n"))
        model.draft = "What's in this file?"
        #expect(!model.canSend)
        await model.attachments.settle()
        #expect(model.attachments.items.first?.state == .ready)
        #expect(model.attachments.turn.tables == ["personal.orders_csv"])
        #expect(model.canSend)

        await model.send()
        await model.streamTask?.value
        #expect(model.attachments.items.isEmpty)
        let question = try #require(model.items.first { $0.role == .user })
        #expect(question.content.contains(.attachment(name: "orders.csv", isImage: false)))
    }

    @Test func refusesBeforeUploadingAndBlocksSending() throws {
        let model = ConversationModel(chat: ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx")!, client: demo())
        model.attachments.add(try file("old.xls", "x"))
        #expect(model.attachments.items.first?.state == .failed(.refused(.legacyExcel)))
        model.draft = "Look at this"
        #expect(!model.canSend)
        model.attachments.remove(try #require(model.attachments.items.first?.id))
        #expect(model.canSend)
    }

    @Test func sendsEveryPartInOrder() async throws {
        let transport = StubTransport([
            .response(status: 200, chunks: [#"{"activeOrganizationId":"org_01jczpznh32py20pd8y10ef9cq"}"#]),
            .response(status: 201, chunks: [#"{"jobId":"fpjob_1","partSizeBytes":4,"partCount":3}"#]),
            .response(status: 204, chunks: []),
            .response(status: 503, headers: ["Retry-After": "0"], chunks: [#"{"code":"PART_BUSY"}"#]),
            .response(status: 204, chunks: []),
            .response(status: 204, chunks: []),
            .response(status: 201, chunks: [#"{"jobId":"fpjob_1","status":"queued"}"#]),
            .response(
                status: 200,
                chunks: [#"{"jobId":"fpjob_1","status":"completed","outputs":[{"status":"completed","documentId":"doc_1"}]}"#]),
            .response(status: 200, chunks: [#"{"id":"doc_1","name":"a.txt","scope":"personal","path":"chats/c/a.txt","type":"file","table":null}"#]),
        ])
        let tray = AttachmentTray(client: .stubbed(transport), chat: ChatID(rawValue: "chat_01jcxj18gtpckep6aw4ynnqjmx")!)
        tray.add(try file("a.txt", "0123456789"))
        await tray.settle()
        #expect(tray.items.first?.state == .ready)
        let parts = transport.requests.filter { $0.method == .put }
        #expect(parts.map(\.url.path) == [
            "/api/uploads/fpjob_1/parts/1", "/api/uploads/fpjob_1/parts/2", "/api/uploads/fpjob_1/parts/2",
            "/api/uploads/fpjob_1/parts/3",
        ])
        #expect(parts.compactMap(\.body).map { String(decoding: $0, as: UTF8.self) } == ["0123", "4567", "4567", "89"])
        #expect(tray.turn.files == ["/personal/chats/c/a.txt"])
        let start = try JSONDecoder().decode(JSONValue.self, from: try #require(transport.requests[1].body))
        #expect(start["destinationPath"]?.stringValue == "/personal/chats/chat_01jcxj18gtpckep6aw4ynnqjmx")
    }
}
