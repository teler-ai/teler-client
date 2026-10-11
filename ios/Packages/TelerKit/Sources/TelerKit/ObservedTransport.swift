import Synchronization

/// Passes requests to another transport and reports each response's status
/// and path, so the app notices an ended session or an unsupported version
/// whichever screen made the request.
public final class ObservedTransport: HTTPTransport, Sendable {
    public typealias Observer = @Sendable (_ status: Int, _ path: String) -> Void

    private let base: any HTTPTransport
    private let observer = Mutex<Observer?>(nil)

    public init(_ base: any HTTPTransport) {
        self.base = base
    }

    public func observe(_ observer: @escaping Observer) {
        self.observer.withLock { $0 = observer }
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse {
        let response = try await base.send(request)
        observer.withLock { $0 }?(response.head.statusCode, request.url.path)
        return response
    }
}
