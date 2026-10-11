import SwiftUI
import TelerFeatures
import TelerKit

/// Signing in with email and password, then two-factor when the account has it.
struct SignInView: View {
    enum Mode: Equatable {
        /// The first screen, with a way into the sample data.
        case start
        /// Over the open app after the session ended, for the same account.
        case again(email: String?)
    }

    let app: AppModel
    let mode: Mode
    @State private var model: SignInModel
    @State private var showsReset = false
    @State private var revealsPassword = false
    @FocusState private var focus: Field?

    private enum Field {
        case email, password, code
    }

    /// `prepare` sets up the new sign-in, such as a state to photograph.
    init(app: AppModel, mode: Mode = .start, prepare: (SignInModel) -> Void = { _ in }) {
        self.app = app
        self.mode = mode
        let model = app.session.makeSignIn()
        if case .again(let email?) = mode { model.email = email }
        prepare(model)
        _model = State(initialValue: model)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    if !app.connectivity.isOnline {
                        Banner(systemImage: "wifi.slash", text: String(localized: "You're offline. Connect to sign in."))
                            .padding(.top, 8)
                    }
                    switch model.step {
                    case .credentials: credentials
                    case .secondFactor: secondFactor
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            .background(Palette.background)
            .safeAreaInset(edge: .bottom) {
                if mode == .start, model.step == .credentials { sampleData }
            }
            .toolbar {
                if model.step == .secondFactor {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Sign in with a different account", systemImage: "chevron.left") {
                            model.startOver()
                        }
                    }
                }
            }
            .onSubmit(advance)
            .sheet(isPresented: $showsReset) {
                ForgotPasswordSheet(app: app, model: model)
            }
            .sheet(isPresented: captchaShown) {
                if let siteKey = model.captchaSiteKey {
                    CaptchaSheet(siteKey: siteKey, origin: app.session.client.origin) { token in
                        Task { await model.captchaSolved(token) }
                    }
                }
            }
        }
    }

    // MARK: Email and password

    @ViewBuilder private var credentials: some View {
        header(
            title: mode == .start ? "Sign in to Teler" : "Sign in again",
            detail: mode == .start
                ? "Your virtual data scientist"
                : "Your session ended. Sign in to carry on; your drafts and open chats stay on this iPhone."
        ) {
            if mode == .start {
                TelerMark().frame(width: 40, height: 35)
            } else {
                IconCircle(systemImage: "lock")
            }
        }
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel("Email")
                FieldBox(look: focus == .email ? .focused : .normal) {
                    TextField("you@example.com", text: $model.email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focus, equals: .email)
                        .disabled(emailIsKept)
                    if emailIsKept {
                        Image(systemName: "lock")
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: 44, height: 44)
                            .accessibilityHidden(true)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel("Password")
                FieldBox(look: passwordLook) {
                    Group {
                        if revealsPassword {
                            TextField("Required", text: $model.password)
                        } else {
                            SecureField("Required", text: $model.password)
                        }
                    }
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus, equals: .password)
                    Button {
                        revealsPassword.toggle()
                    } label: {
                        Image(systemName: revealsPassword ? "eye.slash" : "eye")
                            .foregroundStyle(Palette.mutedForeground)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(revealsPassword ? "Hide password" : "Show password")
                }
                if let problem = model.problem { FieldError(message: problem.message) }
            }
        }
        HStack {
            Spacer()
            Button("Forgot password?") { showsReset = true }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.primaryInk)
                .frame(minHeight: 44)
        }
        .padding(.top, 2)
        PrimaryButton(title: "Sign in", isWorking: model.isWorking) {
            Task { await model.submit() }
        }
        .disabled(!model.canSubmit || !app.connectivity.isOnline)
        .padding(.top, 6)
        if case .again = mode {
            Button("Sign out") { Task { await app.session.signOut() } }
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.primaryInk)
                .frame(minHeight: 44)
                .padding(.top, 12)
        }
    }

    // MARK: Two-factor

    @ViewBuilder private var secondFactor: some View {
        let usesApp = model.factor == .authenticatorCode
        header(
            title: usesApp ? "Two-factor verification" : "Use a backup code",
            detail: usesApp
                ? "Enter the 6-digit code from your authenticator app."
                : "Enter one of your backup codes. Each code works once."
        ) {
            IconCircle(systemImage: usesApp ? "checkmark.shield" : "key")
        }
        VStack(alignment: .leading, spacing: 6) {
            if usesApp {
                OneTimeCodeField(
                    code: $model.code, isFocused: focus == .code, isRejected: model.problem == .invalidCode
                )
                .focused($focus, equals: .code)
            } else {
                FieldLabel("Backup code")
                FieldBox(look: model.problem == .invalidCode ? .error : focus == .code ? .focused : .normal) {
                    TextField("XXXXX-XXXXX", text: $model.code)
                        .textContentType(.oneTimeCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .code)
                }
            }
            if let problem = model.problem { FieldError(message: problem.message) }
        }
        Toggle("Trust this iPhone for 30 days", isOn: $model.trustDevice)
            .font(.subheadline)
            .tint(Palette.primary)
            .padding(.horizontal, 4)
            .padding(.top, 14)
        PrimaryButton(title: "Verify", isWorking: model.isWorking, workingTitle: "Verifying…") {
            Task { await model.submit() }
        }
        .disabled(!model.canSubmit || !app.connectivity.isOnline)
        .padding(.top, 16)
        VStack(spacing: 0) {
            if usesApp {
                Text("Lost access to your authenticator?")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                    .padding(.top, 12)
            }
            Button(usesApp ? "Use a backup code" : "Use authenticator app") {
                model.factor = usesApp ? .backupCode : .authenticatorCode
                model.code = ""
                model.problem = nil
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Palette.primaryInk)
            .frame(minHeight: 44)
        }
        .onAppear { focus = .code }
    }

    // MARK: Parts

    private func header(
        title: LocalizedStringKey, detail: LocalizedStringKey, @ViewBuilder icon: () -> some View
    ) -> some View {
        VStack(spacing: 6) {
            icon()
            Text(title)
                .displayFont(28, relativeTo: .title1)
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 36)
        .padding(.bottom, 28)
        .frame(maxWidth: .infinity)
    }

    private var sampleData: some View {
        HStack(spacing: 6) {
            Text("New to Teler?")
                .foregroundStyle(Palette.mutedForeground)
            Button {
                app.session.startDemo()
            } label: {
                Label("Explore with sample data", systemImage: "flask")
                    .fontWeight(.semibold)
                    .foregroundStyle(Palette.primaryInk)
            }
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(.bottom, 4)
        .background(Palette.background)
    }

    private var emailIsKept: Bool {
        if case .again(let email?) = mode { return !email.isEmpty }
        return false
    }

    private var passwordLook: FieldLook {
        if model.problem == .invalidCredentials { return .error }
        return focus == .password ? .focused : .normal
    }

    private var captchaShown: Binding<Bool> {
        Binding(
            get: { model.captchaSiteKey != nil && !showsReset },
            set: { if !$0 { model.cancelCaptcha() } })
    }

    private func advance() {
        switch focus {
        case .email: focus = .password
        default: Task { await model.submit() }
        }
    }
}

/// The authenticator's six digits in one large field: AutoFill and paste fill it at once.
struct OneTimeCodeField: View {
    @Binding var code: String
    var isFocused = false
    var isRejected = false

    var body: some View {
        TextField("000000", text: $code)
            .textContentType(.oneTimeCode)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(.system(size: 30, weight: .semibold).monospacedDigit())
            .kerning(5.4)
            .foregroundStyle(Palette.foreground)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Palette.card, in: .rect(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(
                        isRejected ? Palette.destructiveInk : isFocused ? Palette.primaryInk : Palette.border,
                        lineWidth: isRejected || isFocused ? 2 : 1)
            }
            .onChange(of: code) { _, new in
                let digits = String(new.filter(\.isNumber).prefix(6))
                if digits != new { code = digits }
            }
            .accessibilityLabel("Six-digit code")
    }
}
