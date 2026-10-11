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
        /// Signed in, but the account has no organization yet or hasn't
        /// finished setting up on the web, so Teler can't answer yet.
        case setupRequired(SignedInUser)
        case demo
    }

    public private(set) var state = State.restoring
    /// The server stopped accepting the session while the app was open. The
    /// app asks to sign in again over the open screens, keeping drafts.
    public private(set) var sessionExpired = false
    /// The server no longer supports this version of the app.
    public private(set) var updateRequired = false
    /// The client for the signed-in account.
    public let client: TelerAPIClient
    private let demoClient: TelerAPIClient
    private let jar: CookieJar

    public init(
        origin: TelerOrigin, identity: ClientIdentity, transport: any HTTPTransport,
        store: any SessionStore, demoClient: TelerAPIClient
    ) {
        jar = CookieJar(store: store)
        let observed = ObservedTransport(transport)
        client = TelerAPIClient(
            origin: origin, identity: identity, transport: observed, authentication: .session(jar))
        self.demoClient = demoClient
        observed.observe { [weak self] status, path in
            Task { @MainActor in self?.noticed(status: status, path: path) }
        }
    }

    private func noticed(status: Int, path: String) {
        switch status {
        case 426:
            updateRequired = true
        case 401 where !path.hasPrefix("/api/auth/"):
            // Sign-in's own failures are answered on the sign-in screen.
            if case .signedIn = state { sessionExpired = true }
        default:
            break
        }
    }

    /// The client behind the screens: the account's, or the demo's.
    public var activeClient: TelerAPIClient { state == .demo ? demoClient : client }

    /// Checks a saved session when the app starts.
    public func restore() async {
        guard await jar.hasSession else {
            state = .signedOut
            return
        }
        let user: SignedInUser
        do {
            guard let found = try await client.currentUser() else {
                await jar.clear()
                state = .signedOut
                return
            }
            user = found
        } catch {
            // Offline or unavailable: keep the session and let screens retry.
            state = .signedIn(nil)
            return
        }
        sessionExpired = false
        do {
            state = try await client.activeOrganization() == nil ? .setupRequired(user) : .signedIn(user)
        } catch {
            state = Problem(error) == .registrationRequired ? .setupRequired(user) : .signedIn(user)
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
        switch state {
        case .signedIn, .setupRequired: try? await client.signOut()
        default: break
        }
        await jar.clear()
        sessionExpired = false
        state = .signedOut
    }
}
