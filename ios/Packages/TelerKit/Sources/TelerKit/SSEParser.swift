/// One dispatched server-sent event.
public struct SSEMessage: Sendable, Equatable {
    /// The `event:` field, or `nil` for the default `message` type.
    public var event: String?
    public var data: String
    /// The last event ID in effect after this event, which a reconnect sends
    /// back as `Last-Event-ID`.
    public var lastEventID: String?

    public init(event: String? = nil, data: String, lastEventID: String? = nil) {
        self.event = event
        self.data = data
        self.lastEventID = lastEventID
    }
}

public enum SSEParserError: Error, Equatable {
    case eventTooLarge
}

/// An incremental parser for `text/event-stream`, following the WHATWG
/// event-stream interpretation rules. Feed it bytes as they arrive; chunk
/// boundaries may fall anywhere, including inside a UTF-8 sequence or `\r\n`.
public struct SSEParser: Sendable {
    public private(set) var lastEventID: String?
    /// The server's `retry:` reconnection delay in milliseconds, if sent.
    public private(set) var retryMilliseconds: Int?

    private let maxEventBytes: Int
    private var line: [UInt8] = []
    private var skipLineFeed = false
    private var atStreamStart = true
    private var eventType = ""
    private var data = ""
    private var eventBytes = 0
    private var lastEventIDBuffer: String?

    public init(maxEventBytes: Int = 8 * 1024 * 1024) {
        self.maxEventBytes = maxEventBytes
    }

    /// Consumes bytes and returns every event they complete.
    public mutating func consume(_ bytes: some Sequence<UInt8>) throws -> [SSEMessage] {
        var messages: [SSEMessage] = []
        for byte in bytes {
            if skipLineFeed {
                skipLineFeed = false
                if byte == 0x0A { continue }
            }
            switch byte {
            case 0x0D:
                skipLineFeed = true
                if let message = try endLine() { messages.append(message) }
            case 0x0A:
                if let message = try endLine() { messages.append(message) }
            default:
                line.append(byte)
                eventBytes += 1
                if eventBytes > maxEventBytes { throw SSEParserError.eventTooLarge }
            }
        }
        return messages
    }

    private mutating func endLine() throws -> SSEMessage? {
        var bytes = line[...]
        line.removeAll(keepingCapacity: true)
        if atStreamStart {
            atStreamStart = false
            if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes = bytes.dropFirst(3) }
        }
        if bytes.isEmpty { return dispatch() }
        if bytes.first == 0x3A { return nil }  // ":" starts a comment.

        let text = String(decoding: bytes, as: UTF8.self)
        let field: Substring
        var value: Substring
        if let colon = text.firstIndex(of: ":") {
            field = text[..<colon]
            value = text[text.index(after: colon)...]
            if value.first == " " { value = value.dropFirst() }
        } else {
            field = text[...]
            value = ""
        }
        switch field {
        case "event":
            eventType = String(value)
        case "data":
            data += value
            data += "\n"
        case "id":
            if !value.contains("\u{0}") { lastEventIDBuffer = String(value) }
        case "retry":
            if !value.isEmpty, value.allSatisfy({ $0.isASCII && $0.isNumber }) {
                retryMilliseconds = Int(value)
            }
        default:
            break
        }
        return nil
    }

    private mutating func dispatch() -> SSEMessage? {
        lastEventID = lastEventIDBuffer
        defer {
            eventType = ""
            data = ""
            eventBytes = 0
        }
        guard !data.isEmpty else { return nil }
        return SSEMessage(
            event: eventType.isEmpty ? nil : eventType,
            data: String(data.dropLast()),
            lastEventID: lastEventID)
    }
}
