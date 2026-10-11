import SwiftUI
import TelerFeatures

/// Asks Teler to email a link for setting a new password in the browser.
struct ForgotPasswordSheet: View {
    let app: AppModel
    @Bindable var model: SignInModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                if model.resetEmailSent {
                    Label("Check your email", systemImage: "envelope")
                        .font(.headline)
                        .foregroundStyle(Palette.foreground)
                    Text("If an account uses that address, we've sent a link to reset its password.")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                    PrimaryButton(title: "Done") { dismiss() }
                } else {
                    Text("Enter your email and we'll send you a link to reset your password.")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                    VStack(alignment: .leading, spacing: 6) {
                        FieldLabel("Email")
                        FieldBox(look: focused ? .focused : .normal) {
                            TextField("you@example.com", text: $model.email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focused)
                                .onSubmit(send)
                        }
                        if let problem = model.problem { FieldError(message: problem.message) }
                    }
                    PrimaryButton(title: "Send reset link", isWorking: model.isWorking, action: send)
                        .disabled(!model.email.contains("@") || !app.connectivity.isOnline)
                    Text("You'll set the new password in your browser.")
                        .font(.footnote)
                        .foregroundStyle(Palette.mutedForeground)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .frame(maxHeight: .infinity, alignment: .top)
            .navigationTitle("Reset your password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
            .sheet(isPresented: captchaShown) {
                if let siteKey = model.captchaSiteKey {
                    CaptchaSheet(siteKey: siteKey, origin: app.session.client.origin) { token in
                        Task { await model.captchaSolved(token) }
                    }
                }
            }
        }
        .presentationDetents([.height(380), .large])
        .onAppear { model.beginPasswordReset() }
    }

    private var captchaShown: Binding<Bool> {
        Binding(get: { model.captchaSiteKey != nil }, set: { if !$0 { model.cancelCaptcha() } })
    }

    private func send() {
        Task { await model.requestPasswordReset() }
    }
}
