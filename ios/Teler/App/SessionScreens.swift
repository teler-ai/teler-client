import SwiftUI
import TelerFeatures
import TelerKit

/// Blocks the app when the server no longer supports this version.
struct UpdateRequiredView: View {
    var body: some View {
        VStack(spacing: 10) {
            IconCircle(systemImage: "arrow.down.circle")
            Text("Update Teler to continue")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.foreground)
                .padding(.top, 6)
            Text("This version no longer works with your account. Update from the App Store; your chats and settings are kept.")
                .font(.subheadline)
                .foregroundStyle(Palette.mutedForeground)
                .multilineTextAlignment(.center)
            Text("You have \(Self.version).")
                .font(.footnote)
                .foregroundStyle(Palette.mutedForeground)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}

/// A signed-in account that Teler can't answer for yet: it needs an
/// organization and its data, which are set up on the web.
struct FinishSetupView: View {
    let app: AppModel
    let user: SignedInUser
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 24) {
                    VStack(spacing: 8) {
                        IconCircle(systemImage: "desktopcomputer")
                        Text("Finish setting up on the web")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .multilineTextAlignment(.center)
                            .padding(.top, 6)
                        Text("Your account needs an organization and a data connection before Teler can answer. Finish on teler.ai; it takes about 5 minutes.")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 72)
                    VStack(spacing: 0) {
                        step("Account created", done: true)
                        Divider().padding(.leading, 44)
                        step("Create your organization", done: false)
                        Divider().padding(.leading, 44)
                        step("Connect your data", done: false)
                    }
                    .background(Palette.card, in: .rect(cornerRadius: 20))
                }
                .padding(.horizontal, 16)
            }
            VStack(spacing: 10) {
                Button {
                    if let url = app.webURL(path: "/") { openURL(url) }
                } label: {
                    Label("Continue on teler.ai", systemImage: "arrow.up.right")
                        .labelStyle(TrailingIconLabelStyle())
                }
                .buttonStyle(PrimaryCapsuleStyle())
                Button {
                    app.session.startDemo()
                } label: {
                    Label("Explore with sample data", systemImage: "flask")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
                Button("Sign out") { Task { await app.session.signOut() } }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.primaryInk)
                    .frame(minHeight: 44)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .background(Palette.background)
        .onChange(of: scenePhase) { _, phase in
            // Back from the browser: check whether setup is done.
            if phase == .active { Task { await app.session.restore() } }
        }
    }

    private func step(_ title: LocalizedStringKey, done: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? Palette.primaryInk : Palette.tertiary)
                .frame(width: 20)
            Text(title)
                .font(.body)
                .foregroundStyle(done ? Palette.mutedForeground : Palette.foreground)
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
        .accessibilityValue(done ? Text("Done") : Text("To do"))
    }
}

/// A label with its icon after the title, as for links that leave the app.
struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}
