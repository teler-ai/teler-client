import Foundation
import Observation
import TelerKit

/// Deleting the member's account, the way the web's account page does it
/// (`apps/auth/web/src/portal/account-deletion-dialog.tsx`): check what
/// blocks it, prepare, prove it's them, confirm, then wait while it finishes
/// in the background. The app's system alert stands in for typing the
/// confirmation phrase.
@MainActor @Observable
public final class AccountDeletionModel {
    public enum Phase: Equatable {
        case checking
        /// Something must be fixed first, mostly on the web.
        case blocked(AccountDeletionCheck)
        /// Nothing blocks it; the member confirms.
        case ready(AccountDeletionCheck)
        /// Prepared; the member proves it's them.
        case proving(AccountDeletionCheck)
        /// Confirmed: sessions end and the deletion finishes in the background.
        case deleting
        case deleted
        /// Accepted, but its end wasn't seen yet; it finishes on its own.
        case accepted
        case failed(Problem)
    }

    /// Why proving it's them didn't work.
    public enum ProofProblem: Equatable {
        case wrong
        case tooManyAttempts
        /// The code email couldn't be sent.
        case codeNotSent
        case other(Problem)
    }

    public private(set) var phase = Phase.checking
    public private(set) var isWorking = false
    public private(set) var proofProblem: ProofProblem?
    public private(set) var codeSent = false
    /// Called once the deletion is confirmed, as every session ends.
    public var sessionsEnding: () -> Void = {}
    private let client: TelerAPIClient
    private var key = UUID().uuidString.lowercased()
    private var operation: String?
    var pollInterval = Duration.seconds(2)

    public init(client: TelerAPIClient) {
        self.client = client
    }

    public func check() async {
        phase = .checking
        do {
            let check = try await client.accountDeletionCheck()
            phase = check.canDelete ? .ready(check) : .blocked(check)
        } catch {
            phase = .failed(Problem(error))
        }
    }

    /// After the member confirms: prepares the deletion so they can prove it's them.
    public func prepare() async {
        guard case .ready(let current) = phase, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            operation = try await client.prepareAccountDeletion(key: key)
            proofProblem = nil
            codeSent = false
            phase = .proving(current)
        } catch TelerAPIError.http(409, "ACCOUNT_DELETION_BLOCKED"?, _) {
            await check()
        } catch {
            phase = .failed(Problem(error))
        }
    }

    /// Emails the code for an account without a password.
    public func sendCode() async {
        guard let operation, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await client.sendAccountDeletionCode(operation: operation, key: key)
            codeSent = true
            proofProblem = nil
        } catch TelerAPIError.http(429, _, _) {
            proofProblem = .tooManyAttempts
        } catch {
            proofProblem = .codeNotSent
        }
    }

    public func confirm(_ proof: AccountDeletionProof, authenticatorCode: String?) async {
        guard let operation, case .proving = phase, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let status = try await client.confirmAccountDeletion(
                operation: operation, key: key, proof: proof, authenticatorCode: authenticatorCode)
            sessionsEnding()
            phase = status == .deleted ? .deleted : .deleting
            if phase == .deleting { await waitUntilDeleted() }
        } catch TelerAPIError.http(401, _, _) {
            proofProblem = .wrong
        } catch TelerAPIError.http(429, _, _) {
            proofProblem = .tooManyAttempts
        } catch TelerAPIError.http(409, "ACCOUNT_DELETION_BLOCKED"?, _) {
            await check()
        } catch TelerAPIError.http(409, "ACCOUNT_DELETION_RECOVERY_REQUIRED"?, _) {
            // The preparation expired: start again with a new one.
            key = UUID().uuidString.lowercased()
            self.operation = nil
            await check()
        } catch {
            proofProblem = .other(Problem(error))
        }
    }

    /// Asks every two seconds until the deletion finished; the server says
    /// it takes a few seconds.
    private func waitUntilDeleted() async {
        guard let operation else { return }
        for _ in 0..<90 {
            try? await Task.sleep(for: pollInterval)
            if Task.isCancelled { return }
            if (try? await client.accountDeletionStatus(operation: operation, key: key)) == .deleted {
                phase = .deleted
                return
            }
        }
        // The deletion was accepted; it finishes even if this couldn't see it.
        phase = .accepted
    }
}
