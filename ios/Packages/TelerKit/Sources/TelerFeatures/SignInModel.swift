import Foundation
import Observation
import TelerKit

/// Native sign-in: email and password, then the two-factor step when the
/// account has it. When the server asks for a captcha, `captchaSiteKey` is set
/// and the app shows the check, then calls `captchaSolved`.
@MainActor @Observable
public final class SignInModel {
    public enum Step: Equatable {
        case credentials
        case secondFactor
    }

    private enum Action {
        case signIn
        case resetPassword
    }

    public var email = ""
    public var password = ""
    public var code = ""
    public var factor = SecondFactor.authenticatorCode
    public var trustDevice = true
    public var problem: Problem?
    public private(set) var step = Step.credentials
    public private(set) var isWorking = false
    public private(set) var captchaSiteKey: String?
    public private(set) var resetEmailSent = false

    private let client: TelerAPIClient
    private let onSignedIn: @MainActor () async -> Void
    private var awaitingCaptcha: Action?

    public init(client: TelerAPIClient, onSignedIn: @escaping @MainActor () async -> Void) {
        self.client = client
        self.onSignedIn = onSignedIn
    }

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    public var canSubmit: Bool {
        guard !isWorking else { return false }
        switch step {
        case .credentials: return trimmedEmail.contains("@") && !password.isEmpty
        case .secondFactor:
            let code = code.trimmingCharacters(in: .whitespaces)
            return factor == .authenticatorCode
                ? code.count == 6 && code.allSatisfy(\.isNumber) : !code.isEmpty
        }
    }

    public func submit() async {
        guard canSubmit else { return }
        switch step {
        case .credentials: await signIn(captcha: nil)
        case .secondFactor: await verifyCode()
        }
    }

    /// Clears a previous reset, for asking again.
    public func beginPasswordReset() {
        resetEmailSent = false
        problem = nil
    }

    public func requestPasswordReset() async {
        guard trimmedEmail.contains("@"), !isWorking else { return }
        await resetPassword(captcha: nil)
    }

    /// Retries what the captcha interrupted, with the solved token.
    public func captchaSolved(_ token: String) async {
        let action = awaitingCaptcha
        awaitingCaptcha = nil
        captchaSiteKey = nil
        switch action {
        case .signIn?: await signIn(captcha: token)
        case .resetPassword?: await resetPassword(captcha: token)
        case nil: break
        }
    }

    public func cancelCaptcha() {
        awaitingCaptcha = nil
        captchaSiteKey = nil
    }

    #if DEBUG
        /// Opens the two-factor step without a server, for screenshots.
        public func showSecondFactorForScreenshots() {
            step = .secondFactor
        }
    #endif

    /// Leaves the two-factor step to sign in again.
    public func startOver() {
        step = .credentials
        code = ""
        problem = nil
    }

    private func signIn(captcha: String?) async {
        await run(.signIn) {
            switch try await self.client.signIn(
                email: self.trimmedEmail, password: self.password, captcha: captcha)
            {
            case .signedIn:
                self.password = ""
                await self.onSignedIn()
            case .secondFactorRequired:
                self.step = .secondFactor
            }
        }
    }

    private func resetPassword(captcha: String?) async {
        await run(.resetPassword) {
            try await self.client.requestPasswordReset(email: self.trimmedEmail, captcha: captcha)
            self.resetEmailSent = true
        }
    }

    private func verifyCode() async {
        await run(.signIn) {
            try await self.client.verifySecondFactor(
                self.code.trimmingCharacters(in: .whitespaces), using: self.factor,
                trustDevice: self.trustDevice)
            self.password = ""
            self.code = ""
            await self.onSignedIn()
        }
    }

    /// Runs one request, turning a captcha demand into the captcha step.
    private func run(_ action: Action, _ work: @MainActor () async throws -> Void) async {
        isWorking = true
        problem = nil
        defer { isWorking = false }
        do {
            try await work()
        } catch {
            let problem = Problem(error)
            switch problem {
            case .captchaRequired:
                if let key = try? await client.captchaSiteKey() {
                    awaitingCaptcha = action
                    captchaSiteKey = key
                } else {
                    self.problem = .other
                }
            case .signInExpired:
                startOver()
                self.problem = problem
            case .invalidCredentials:
                password = ""
                self.problem = problem
            default:
                self.problem = problem
            }
        }
    }
}
