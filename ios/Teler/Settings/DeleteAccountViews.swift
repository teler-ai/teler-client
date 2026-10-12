import SwiftUI
import TelerFeatures
import TelerKit

/// What must be fixed before the account can be deleted, mostly on the web.
struct DeletionBlockedView: View {
    let app: AppModel
    let check: AccountDeletionCheck

    var body: some View {
        List {
            Section {
                VStack(spacing: 12) {
                    IconTile(systemImage: ownsShared ? "building.2" : "exclamationmark.triangle")
                    Text(ownsShared ? "Add another owner first" : "Account deletion isn't available yet")
                        .font(.title3.weight(.bold))
                        .multilineTextAlignment(.center)
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            if !check.organizations.isEmpty {
                Section("Your organizations") {
                    ForEach(check.organizations) { organization in
                        HStack(spacing: 12) {
                            Avatar(initials: initials(organization.name), style: .alternate, size: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(organization.name).foregroundStyle(Palette.foreground)
                                Text(note(for: organization))
                                    .font(.subheadline)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                            Spacer()
                            if blocks(organization) {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(Palette.warningInk)
                                    .accessibilityLabel("Blocks deletion")
                            }
                        }
                    }
                }
            }
            let reasons = check.blockers.filter { $0.code != "shared_organization_owner" }.map(Self.message)
            if !reasons.isEmpty {
                Section("Before deleting") {
                    ForEach(Array(Set(reasons)).sorted(), id: \.self) { reason in
                        Text(reason).foregroundStyle(Palette.foreground)
                    }
                }
            }
            Section {
                if let url = webURL {
                    Link(destination: url) {
                        Label(ownsShared ? "Open members on the web" : "Open your account on the web", systemImage: "safari")
                            .font(.body.weight(.semibold))
                    }
                }
            } footer: {
                Text("Your account stays as it is until then.")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle("Delete account")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var ownsShared: Bool { check.blockers.contains { $0.code == "shared_organization_owner" } }

    private var blockingOrganization: AccountDeletionCheck.Organization? {
        check.organizations.first(where: blocks)
    }

    private var summary: String {
        if ownsShared, let organization = blockingOrganization {
            return organization.possibleOwners == 0
                ? String(
                    localized:
                        "You're the only owner of \(organization.name). Add another member, make them an owner, or delete the organization. All of this is on the web."
                )
                : String(
                    localized:
                        "You're the only owner of \(organization.name). Before deleting your account, make another member an owner, or delete the organization. Both are on the web."
                )
        }
        return String(localized: "Something needs to be resolved first. Your account stays as it is.")
    }

    private func blocks(_ organization: AccountDeletionCheck.Organization) -> Bool {
        check.blockers.contains { $0.organizationID == organization.id }
    }

    private func note(for organization: AccountDeletionCheck.Organization) -> String {
        let role = organization.role.prefix(1).uppercased() + organization.role.dropFirst()
        return blocks(organization)
            ? String(localized: "\(role) · needs another owner") : String(localized: "\(role) · nothing to do")
    }

    private var webURL: URL? {
        if ownsShared, let organization = blockingOrganization {
            return app.accountWebURL(path: "/organizations/\(organization.slug)/members")
        }
        return app.accountWebURL(path: "/account")
    }

    private func initials(_ name: String) -> String {
        String(name.split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)).uppercased()
    }

    /// The web's words for each blocker (`accountPage.deleteAccountBlockers`).
    static func message(_ blocker: AccountDeletionCheck.Blocker) -> String {
        switch blocker.code {
        case "runtime_safety_unavailable":
            String(localized: "Account deletion is temporarily unavailable. Please try again later.")
        case "reauthentication_required":
            String(localized: "Verify your email address before confirming account deletion.")
        case "personal_organization_has_members":
            String(localized: "Remove other members from your personal organization first.")
        case "personal_organization_pending_invitation":
            String(localized: "Resolve pending invitations in your personal organization first.")
        case "personal_subscription_active":
            String(
                localized:
                    "Your personal subscription must be fully cancelled first. Deleting your account will not cancel it for you."
            )
        case "personal_subscription_unverified":
            String(
                localized:
                    "We couldn't safely verify that your personal subscription has ended. Try again shortly or contact support."
            )
        case "personal_credit_balance":
            String(localized: "Use or settle the remaining personal organization credit balance first.")
        case "active_seat_reduction":
            String(localized: "A change to your organization’s subscription is still being processed. Please try again shortly.")
        case "active_exploration":
            String(localized: "Wait for queued or running analyses to finish before deleting your account.")
        case "active_file_processing", "active_archive_processing", "active_storage_reservation":
            String(localized: "Wait for file processing to finish.")
        case "shared_organization_resource_unresolved":
            String(localized: "Resolve or transfer resources you own in a shared organization before deleting your account.")
        default:
            String(localized: "An account requirement must be resolved before deletion.")
        }
    }
}

/// "Confirm it's you": the password, or a code emailed to accounts without
/// one, plus the authenticator code when two-factor is on.
struct ConfirmIdentitySheet: View {
    let model: AccountDeletionModel
    let check: AccountDeletionCheck
    @State private var password = ""
    @State private var emailCode = ""
    @State private var authenticatorCode = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Confirm it's you").font(.title3.weight(.bold))
                        Text("For your security, confirm it's you to delete your account. Deleting starts as soon as you confirm.")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    switch check.proof {
                    case .password:
                        VStack(alignment: .leading, spacing: 8) {
                            FieldLabel("Password")
                            FieldBox(look: model.proofProblem == .wrong ? .error : .normal) {
                                SecureField("Required", text: $password)
                                    .textContentType(.password)
                            }
                        }
                    case .emailCode:
                        if model.codeSent {
                            VStack(alignment: .leading, spacing: 8) {
                                FieldLabel("Code from the email")
                                FieldBox(look: model.proofProblem == .wrong ? .error : .normal) {
                                    TextField("Paste the code", text: $emailCode)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                        .font(.body.monospaced())
                                }
                                Text("Check your email and paste the latest code within 10 minutes.")
                                    .font(.footnote)
                                    .foregroundStyle(Palette.mutedForeground)
                            }
                        } else {
                            Text("Your account has no password, so Teler emails you a code to confirm it's you.")
                                .font(.subheadline)
                                .foregroundStyle(Palette.mutedForeground)
                            Button("Email me a code") { Task { await model.sendCode() } }
                                .buttonStyle(.glass)
                                .disabled(model.isWorking)
                        }
                    }
                    if check.needsCode {
                        VStack(alignment: .leading, spacing: 8) {
                            FieldLabel("Authenticator code")
                            OneTimeCodeField(code: $authenticatorCode, isRejected: model.proofProblem == .wrong)
                        }
                    }
                    if let problem = model.proofProblem { FieldError(message: message(problem)) }
                    PrimaryButton(title: "Delete account", isWorking: model.isWorking, workingTitle: "Deleting…") {
                        Task { await confirm() }
                    }
                    .disabled(!canConfirm)
                }
                .padding()
            }
            .background(Palette.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents(check.needsCode || check.proof == .emailCode ? [.large] : [.height(430), .large])
        .interactiveDismissDisabled(model.isWorking)
    }

    private var canConfirm: Bool {
        let proven = check.proof == .password ? !password.isEmpty : emailCode.count >= 64
        return proven && (!check.needsCode || authenticatorCode.count == 6) && !model.isWorking
    }

    private func confirm() async {
        let proof: AccountDeletionProof = check.proof == .password ? .password(password) : .emailCode(emailCode)
        await model.confirm(proof, authenticatorCode: check.needsCode ? authenticatorCode : nil)
        switch model.phase {
        case .deleting, .deleted, .accepted, .blocked, .ready: dismiss()
        default: break
        }
    }

    private func message(_ problem: AccountDeletionModel.ProofProblem) -> String {
        switch problem {
        case .wrong: String(localized: "That didn't match. Check it and try again.")
        case .tooManyAttempts: String(localized: "Too many attempts. Wait a few minutes, then try again.")
        case .codeNotSent: String(localized: "We couldn't send the code. Please try again later.")
        case .other(let problem): problem.message
        }
    }
}

/// While the deletion finishes, and after: it can't be cancelled, and every
/// device is signed out.
struct DeletionProgressView: View {
    let phase: AccountDeletionModel.Phase
    let done: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            switch phase {
            case .deleted, .accepted:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(Palette.primaryInk)
                Text(phase == .deleted ? "Your account is deleted" : "Your account is being deleted")
                    .font(.title3.weight(.bold))
                Text(
                    phase == .deleted
                        ? "We removed your account and personal data, and signed you out everywhere."
                        : "Your deletion request has been accepted. We're deleting your personal data."
                )
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
                Spacer()
                PrimaryButton(title: "Done", action: done)
            default:
                TelerMark().frame(width: 36, height: 32)
                Text("Deleting your account…").font(.title3.weight(.bold))
                Text("Signing you out on every device. This takes a few seconds.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                    .multilineTextAlignment(.center)
                Spacer()
            }
        }
        .foregroundStyle(Palette.foreground)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .interactiveDismissDisabled()
    }
}
