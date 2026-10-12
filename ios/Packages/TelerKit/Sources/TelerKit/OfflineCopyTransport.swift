import Foundation
import Synchronization

/// Keeps the last answer to the reads Today, Chats and Dashboards show, so
/// they still have a saved copy without a connection (board 04, Offline).
///
/// Only successful GETs of the paths below are saved, in the app's caches
/// folder. When such a request fails for lack of a network, the saved copy
/// answers instead, marked with `savedAtHeader`. Signing out clears it.
public final class OfflineCopyTransport: HTTPTransport, Sendable {
    /// When a response is a saved copy: the time it was saved, in ISO 8601.
    public static let savedAtHeader = "Teler-Offline-Copy"
    /// Larger answers aren't kept.
    static let maximumBytes = 4 * 1024 * 1024

    private let base: any HTTPTransport
    private let directory: URL
    private let lastSaved = Mutex<Date?>(nil)

    public init(_ base: any HTTPTransport, directory: URL) {
        self.base = base
        self.directory = directory
    }

    /// When a copy was last saved, to say what time a saved Today is from.
    public var savedAt: Date? { lastSaved.withLock { $0 } }

    public func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse {
        guard request.method == .get, Self.keeps(request.url.path) else { return try await base.send(request) }
        let file = directory.appendingPathComponent(Self.fileName(for: request.url))
        do {
            let response = try await base.send(request)
            guard response.head.statusCode == 200 else { return response }
            let data = try await response.collectBody(limit: Self.maximumBytes)
            save(data, to: file)
            return HTTPStreamingResponse(head: response.head, body: Self.body(data))
        } catch where Self.isOffline(error) {
            guard let data = try? Data(contentsOf: file),
                let saved = try? FileManager.default.attributesOfItem(atPath: file.path)[.modificationDate] as? Date
            else { throw error }
            let head = HTTPResponseHead(
                statusCode: 200,
                headers: ["Content-Type": "application/json", Self.savedAtHeader: saved.formatted(.iso8601)])
            return HTTPStreamingResponse(head: head, body: Self.body(data))
        }
    }

    /// Deletes every saved copy, such as when the member signs out.
    public func clear() {
        try? FileManager.default.removeItem(at: directory)
        lastSaved.withLock { $0 = nil }
    }

    private func save(_ data: Data, to file: URL) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            #if canImport(Darwin)
                try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
                try data.write(to: file, options: .atomic)
            #endif
            lastSaved.withLock { $0 = Date() }
        } catch {
            // A copy that can't be saved just isn't there offline.
        }
    }

    /// The reads that make a useful saved copy: lists, chats with their
    /// charts, Needs you and dashboards. Never streams or anything else.
    static func keeps(_ path: String) -> Bool {
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "api" else { return false }
        switch (parts[1], parts.count) {
        case ("chat", 2), ("chat", 3): return parts.count == 2 || !["search", "starter-prompts"].contains(parts[2])
        case ("chat", 6): return parts[3] == "artifact" && parts[5] == "data"
        case ("home", 3): return parts[2] == "flags"
        case ("access", 3): return parts[2] == "activity"
        case ("dashboard", 2), ("dashboard", 3): return true
        case ("dashboard", 6): return parts[3] == "widget" && parts[5] == "data"
        case ("teler-cli", 3): return parts[2] == "me"
        default: return false
        }
    }

    /// No connection, as the app's transport reports it or as Foundation does.
    static func isOffline(_ error: Error) -> Bool {
        if case TelerAPIError.network = error { return true }
        guard let error = error as? URLError else { return false }
        return [
            .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost, .timedOut,
            .dataNotAllowed, .internationalRoamingOff, .dnsLookupFailed,
        ].contains(error.code)
    }

    /// One file per path and query, named by their FNV-1a hash.
    static func fileName(for url: URL) -> String {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = (components?.queryItems ?? []).map { "\($0.name)=\($0.value ?? "")" }.sorted().joined(separator: "&")
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in "\(url.path)?\(query)".utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return String(hash, radix: 16) + ".json"
    }

    private static func body(_ data: Data) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(data)
            continuation.finish()
        }
    }
}
