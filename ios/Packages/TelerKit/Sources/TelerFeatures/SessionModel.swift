import Observation
import TelerKit

/// Whether someone is signed in, and the client to use for their data.
@MainActor @Observable
public final class SessionModel {
    public enum State: Equatable {
        case restoring
        case signedOut
        /// The user is nil when the app opened offline with a saved session.
        case signedIn(SignedInUser?)
        case demo
    }

    public private(set) var state = State.restoring
    /// The client for the signed-in account.
    public let client: TelerAPIClient
    private let demoClient: TelerAPIClient
    private let jar: CookieJar

    public init(
        origin: TelerOrigin, identity: ClientIdentity, transport: any HTTPTransport,
        store: any SessionStore, demoClient: TelerAPIClient
    ) {
        jar = CookieJar(store: store)
        client = TelerAPIClient(
            origin: origin, identity: identity, transport: transport, authentication: .session(jar))
        self.demoClient = demoClient
    }

    /// The client behind the screens: the account's, or the demo's.
    public var activeClient: TelerAPIClient { state == .demo ? demoClient : client }

    /// Checks a saved session when the app starts.
    public func restore() async {
        guard await jar.hasSession else {
            state = .signedOut
            return
        }
        do {
            if let user = try await client.currentUser() {
                state = .signedIn(user)
            } else {
                await jar.clear()
                state = .signedOut
            }
        } catch {
            // Offline or unavailable: keep the session and let screens retry.
            state = .signedIn(nil)
        }
    }

    public func makeSignIn() -> SignInModel {
        SignInModel(client: client) { [weak self] in await self?.restore() }
    }

    public func startDemo() {
        state = .demo
    }

    /// Ends the session on the server when reachable, and always on the device.
    public func signOut() async {
        if case .signedIn = state { try? await client.signOut() }
        await jar.clear()
        state = .signedOut
    }
}
