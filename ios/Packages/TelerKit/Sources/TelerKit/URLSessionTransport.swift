import Foundation
import Synchronization

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Sends requests with `URLSession`, delivering the body as it arrives.
///
/// It uses session delegate callbacks rather than `bytes(for:)` so the same
/// code streams on Apple platforms and Linux. Redirects are never followed,
/// cookies and caches are never stored, and the bearer token stays in memory.
public final class URLSessionTransport: NSObject, HTTPTransport, Sendable {
    private struct Pending {
        var head: CheckedContinuation<HTTPResponseHead, Error>?
        let body: AsyncThrowingStream<Data, Error>.Continuation
    }

    private let pending = Mutex<[Int: Pending]>([:])
    private let session = Mutex<URLSession?>(nil)

    public init(idleTimeout: TimeInterval = 75) {
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // Teler's event streams send a heartbeat every 30 seconds.
        configuration.timeoutIntervalForRequest = idleTimeout
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        session.withLock {
            $0 = URLSession(
                configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        }
    }

    /// Cancels outstanding requests and releases the session.
    public func invalidate() {
        session.withLock { $0?.invalidateAndCancel() }
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPStreamingResponse {
        guard let session = session.withLock({ $0 }) else { throw CancellationError() }
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.rawValue
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        urlRequest.httpBody = request.body

        let (body, bodyContinuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let task = session.dataTask(with: urlRequest)
        let identifier = task.taskIdentifier
        bodyContinuation.onTermination = { termination in
            if case .cancelled = termination { task.cancel() }
        }
        let head = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { headContinuation in
                pending.withLock {
                    $0[identifier] = Pending(head: headContinuation, body: bodyContinuation)
                }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
        return HTTPStreamingResponse(head: head, body: body)
    }

    private func takeHead(for task: URLSessionTask) -> CheckedContinuation<HTTPResponseHead, Error>? {
        pending.withLock { entries in
            let head = entries[task.taskIdentifier]?.head
            entries[task.taskIdentifier]?.head = nil
            return head
        }
    }
}

extension URLSessionTransport: URLSessionDataDelegate {
    public func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
        completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse else {
            takeHead(for: dataTask)?.resume(throwing: TelerAPIError.invalidResponse)
            completionHandler(.cancel)
            return
        }
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            if let name = name as? String, let value = value as? String { headers[name] = value }
        }
        takeHead(for: dataTask)?.resume(
            returning: HTTPResponseHead(statusCode: http.statusCode, headers: headers))
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data)
    {
        let body = pending.withLock { $0[dataTask.taskIdentifier]?.body }
        body?.yield(data)
    }

    public func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        // Deliver the 3xx itself; the client refuses it.
        completionHandler(nil)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?)
    {
        let entry = pending.withLock { $0.removeValue(forKey: task.taskIdentifier) }
        guard let entry else { return }
        let failure: Error? = error.map { error in
            (error as? URLError)?.code == .cancelled ? CancellationError() as Error : TelerAPIError.network
        }
        if let failure {
            entry.head?.resume(throwing: failure)
            entry.body.finish(throwing: failure)
        } else {
            entry.head?.resume(throwing: TelerAPIError.invalidResponse)
            entry.body.finish()
        }
    }
}
