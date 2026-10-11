import Foundation

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case patch = "PATCH"
    case put = "PUT"
    case delete = "DELETE"
}

public struct HTTPRequest: Sendable {
    public var url: URL
    public var method: HTTPMethod
    public var headers: [String: String]
    public var body: Data?

    public init(url: URL, method: HTTPMethod, headers: [String: String] = [:], body: Data? = nil) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

public struct HTTPResponseHead: Sendable {
    public let statusCode: Int
    private let headers: [String: String]

    public init(statusCode: Int, headers: [String: String] = [:]) {
        self.statusCode = statusCode
        self.headers = Dictionary(
            headers.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { first, _ in first })
    }

    public func header(_ name: String) -> String? { headers[name.lowercased()] }
}

/// A response whose body arrives in chunks, so event streams can be read live.
public struct HTTPStreamingResponse: Sendable {
    public let head: HTTPResponseHead
    public let body: AsyncThrowingStream<Data, Error>

    public init(head: HTTPResponseHead, body: AsyncThrowingStream<Data, Error>) {
        self.head = head
        self.body = body
    }

    /// Reads the whole body, refusing anything larger than `limit` bytes.
    public func collectBody(limit: Int) async throws -> Data {
        var data = Data()
        for try await chunk in body {
            data.append(chunk)
            if data.count > limit { throw TelerAPIError.responseTooLarge }
        }
        return data
    }
}

/// Sends requests without following redirects. `URLSessionTransport` is the
/// production implementation; tests and the demo mode provide their own.
public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse
}
