import Foundation

/// How the client proves who it is.
public enum Authentication: Sendable {
    case none
    /// A bearer token, as the CLI uses.
    case bearer(@Sendable () async -> String?)
    /// The same cookie session as the web app. Requests carry the cookies and
    /// the origin's `Origin`, as the web app's own requests do.
    case session(CookieJar)
}

/// Calls Teler's HTTP API as an authenticated client: `Teler-Client` version
/// header, no redirects, and errors that never echo server or network text.
public struct TelerAPIClient: Sendable {
    public let origin: TelerOrigin
    public let identity: ClientIdentity
    public let authentication: Authentication
    private let transport: any HTTPTransport

    static let maximumErrorBody = 64 * 1024
    static let maximumJSONBody = 16 * 1024 * 1024

    public init(
        origin: TelerOrigin,
        identity: ClientIdentity,
        transport: any HTTPTransport,
        authentication: Authentication = .none
    ) {
        self.origin = origin
        self.identity = identity
        self.transport = transport
        self.authentication = authentication
    }

    /// Sends a request and returns the successful response with its body
    /// unread, so callers can stream it.
    public func send(
        _ method: HTTPMethod,
        _ path: String,
        query: [URLQueryItem] = [],
        headers extra: [String: String] = [:],
        body: Data? = nil,
        accept: String = "application/json"
    ) async throws -> HTTPStreamingResponse {
        var headers = extra
        headers["Accept"] = accept
        headers["Teler-Client"] = identity.headerValue
        headers["User-Agent"] = identity.headerValue
        switch authentication {
        case .none:
            break
        case .bearer(let token):
            if let token = await token() { headers["Authorization"] = "Bearer \(token)" }
        case .session(let jar):
            if let cookies = await jar.headerValue(for: path) { headers["Cookie"] = cookies }
            headers["Origin"] = origin.description
        }
        if body != nil, headers["Content-Type"] == nil {
            headers["Content-Type"] = "application/json"
        }
        let request = HTTPRequest(
            url: try origin.url(path: path, query: query), method: method, headers: headers,
            body: body)

        let response: HTTPStreamingResponse
        do {
            response = try await transport.send(request)
        } catch let error as CancellationError {
            throw error
        } catch {
            throw TelerAPIError.network
        }
        if case .session(let jar) = authentication, let setCookie = response.head.header("Set-Cookie") {
            await jar.update(setCookie: setCookie)
        }
        let status = response.head.statusCode
        if (300..<400).contains(status) { throw TelerAPIError.redirectRefused(status: status) }
        guard (200..<300).contains(status) else {
            let body = (try? await response.collectBody(limit: Self.maximumErrorBody)) ?? Data()
            throw TelerAPIError.from(head: response.head, body: body)
        }
        return response
    }

    /// Sends a request and decodes its JSON response.
    public func json<Response: Decodable>(
        _ type: Response.Type,
        _ method: HTTPMethod = .get,
        _ path: String,
        query: [URLQueryItem] = [],
        headers: [String: String] = [:],
        body: Data? = nil
    ) async throws -> Response {
        let response = try await send(method, path, query: query, headers: headers, body: body)
        let data = try await response.collectBody(limit: Self.maximumJSONBody)
        do {
            return try Self.makeDecoder().decode(Response.self, from: data)
        } catch {
            throw TelerAPIError.invalidResponse
        }
    }

    public static func encode(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            guard let date = parseISO8601(string) else {
                throw DecodingError.dataCorruptedError(
                    in: container, debugDescription: "Expected an ISO 8601 date")
            }
            return date
        }
        return decoder
    }

    /// Teler sends `Date.toISOString()` values, which carry milliseconds.
    static func parseISO8601(_ string: String) -> Date? {
        if let date = try? Date(
            string, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        {
            return date
        }
        return try? Date(string, strategy: Date.ISO8601FormatStyle())
    }
}
