import Testing

@testable import TelerKit

@Suite struct SSEParserTests {
    private func parse(_ chunks: [String]) throws -> [SSEMessage] {
        var parser = SSEParser()
        return try chunks.flatMap { try parser.consume(Array($0.utf8)) }
    }

    @Test func dispatchesAnEventWithItsTypeAndID() throws {
        let messages = try parse(["event: content\nid: 3\ndata: {\"done\":false}\n\n"])
        #expect(messages == [SSEMessage(event: "content", data: "{\"done\":false}", lastEventID: "3")])
    }

    @Test func joinsDataLinesWithNewlines() throws {
        #expect(try parse(["data: one\ndata: two\n\n"]).map(\.data) == ["one\ntwo"])
    }

    @Test func acceptsCRLFAndCRSplitAcrossChunks() throws {
        let messages = try parse(["data: a\r", "\n\r", "\ndata: b\r\r"])
        #expect(messages.map(\.data) == ["a", "b"])
    }

    @Test func keepsUTF8SequencesSplitAcrossChunks() throws {
        let bytes = Array("data: Dalí €\n\n".utf8)
        var parser = SSEParser()
        var messages: [SSEMessage] = []
        for byte in bytes { messages += try parser.consume([byte]) }
        #expect(messages.map(\.data) == ["Dalí €"])
    }

    @Test func ignoresCommentsAndKeepsTheLastEventIDWithoutData() throws {
        var parser = SSEParser()
        #expect(try parser.consume(Array(": heartbeat\nid: 7\n\n".utf8)).isEmpty)
        #expect(parser.lastEventID == "7")
        let next = try parser.consume(Array("data: x\n\n".utf8))
        #expect(next.first?.lastEventID == "7")
    }

    @Test func ignoresAnIDContainingNull() throws {
        var parser = SSEParser()
        _ = try parser.consume(Array("id: 1\n\nid: 2\u{0}\ndata: x\n\n".utf8))
        #expect(parser.lastEventID == "1")
    }

    @Test func stripsOneLeadingSpaceAndALeadingByteOrderMark() throws {
        let messages = try parse(["\u{FEFF}data:  padded\n\n", "data:tight\n\n"])
        #expect(messages.map(\.data) == [" padded", "tight"])
    }

    @Test func readsRetryOnlyWhenNumeric() throws {
        var parser = SSEParser()
        _ = try parser.consume(Array("retry: 2500\n\nretry: soon\n\n".utf8))
        #expect(parser.retryMilliseconds == 2500)
    }

    @Test func dropsAnUnterminatedEventAtTheEnd() throws {
        #expect(try parse(["data: complete\n\ndata: partial"]).map(\.data) == ["complete"])
    }

    @Test func refusesAnOversizedEvent() throws {
        var parser = SSEParser(maxEventBytes: 16)
        #expect(throws: SSEParserError.eventTooLarge) {
            try parser.consume(Array("data: 0123456789abcdef\n\n".utf8))
        }
    }
}
