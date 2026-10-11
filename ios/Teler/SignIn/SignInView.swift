import SwiftUI
import TelerFeatures
import TelerKit

struct SignInView: View {
    let app: AppModel
    @State private var model: SignInModel
    @State private var showsReset = false
    @FocusState private var focus: Field?

    private enum Field {
        case email, password, code
    }

    init(app: AppModel) {
        self.app = app
        _model = State(initialValue: app.session.makeSignIn())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Teler")
                            .font(.largeTitle.weight(.semibold))
                        Text(
                            model.step == .credentials
                                ? "Ask your data anything." : "Enter the code from your authenticator app."
                        )
                        .foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
                switch model.step {
                case .credentials: credentials
                case .secondFactor: secondFactor
                }
                if let problem = model.problem {
                    Section {
                        Label(problem.message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Palette.warningInk)
                    }
                }
                Section {
                    Button {
                        Task { await model.submit() }
                    } label: {
                        HStack {
                            Spacer()
                            if model.isWorking {
                                ProgressView()
                            } else {
                                Text(model.step == .credentials ? "Sign in" : "Verify").bold()
                            }
                            Spacer()
                        }
                    }
                    .disabled(!model.canSubmit)
                }
                footer
            }
            .scrollDismissesKeyboard(.interactively)
            .onSubmit(advance)
            .sheet(isPresented: captchaShown) {
                if let siteKey = model.captchaSiteKey {
                    CaptchaSheet(siteKey: siteKey, origin: app.session.client.origin) { token in
                        Task { await model.captchaSolved(token) }
                    }
                }
            }
            .alert("Check your email", isPresented: $showsReset) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("If an account uses that address, we've sent a link to reset its password.")
            }
            .onChange(of: model.resetEmailSent) { _, sent in showsReset = sent }
        }
    }

    @ViewBuilder private var credentials: some View {
        Section {
            TextField("Email", text: $model.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
            SecureField("Password", text: $model.password)
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focus, equals: .password)
        }
    }

    @ViewBuilder private var secondFactor: some View {
        Section {
            TextField(
                model.factor == .authenticatorCode ? "6-digit code" : "Backup code", text: $model.code
            )
            .textContentType(.oneTimeCode)
            .keyboardType(model.factor == .authenticatorCode ? .numberPad : .asciiCapable)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: .code)
            Toggle("Trust this iPhone for 30 days", isOn: $model.trustDevice)
        } footer: {
            Button(
                model.factor == .authenticatorCode ? "Use a backup code instead" : "Use my authenticator app"
            ) {
                model.factor = model.factor == .authenticatorCode ? .backupCode : .authenticatorCode
                model.code = ""
            }
            .font(.footnote)
        }
        .onAppear { focus = .code }
    }

    @ViewBuilder private var footer: some View {
        Section {
            if model.step == .credentials {
                Button("Forgot password?") { Task { await model.requestPasswordReset() } }
                    .disabled(!model.email.contains("@") || model.isWorking)
                if let signUp = app.webURL(path: "/sign-up") {
                    Link("Create an account on the web", destination: signUp)
                }
                Button("Explore with sample data") { app.session.startDemo() }
            } else {
                Button("Sign in with a different account") { model.startOver() }
            }
        }
        .font(.subheadline)
    }

    private var captchaShown: Binding<Bool> {
        Binding(
            get: { model.captchaSiteKey != nil },
            set: { if !$0 { model.cancelCaptcha() } })
    }

    private func advance() {
        switch focus {
        case .email: focus = .password
        default: Task { await model.submit() }
        }
    }
}
