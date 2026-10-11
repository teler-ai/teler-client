import SwiftUI
import TelerFeatures

@main
struct TelerApp: App {
    @State private var app = AppModel()
    @AppStorage("appearance") private var appearance = Appearance.system

    init() {
        Typeface.setUp()
    }

    var body: some Scene {
        WindowGroup {
            RootView(app: app)
                .environment(app)
                .tint(Palette.primaryInk)
                .preferredColorScheme(appearance.colorScheme)
        }
    }
}

/// Signs in first, then shows the app for the account or the demo.
struct RootView: View {
    let app: AppModel

    /// Shown over the app until the account signs in again or signs out.
    private var sessionExpired: Binding<Bool> {
        Binding(get: { app.session.sessionExpired }, set: { _ in })
    }

    var body: some View {
        Group {
            #if DEBUG
                if case .screen(let name)? = DebugRoute.atLaunch {
                    DebugScreen(app: app, name: name)
                } else {
                    content
                }
            #else
                content
            #endif
        }
        .task {
            if DebugRoute.startsInDemo {
                app.session.startDemo()
            } else {
                await app.session.restore()
            }
        }
    }

    @ViewBuilder private var content: some View {
        Group {
            if app.session.updateRequired {
                UpdateRequiredView()
            } else {
                switch app.session.state {
                case .restoring:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Palette.background)
                case .signedOut:
                    SignInView(app: app)
                case .setupRequired(let user):
                    FinishSetupView(app: app, user: user)
                case .signedIn(let user):
                    MainView(app: app)
                        .id(app.workspaceGeneration)
                        .sheet(isPresented: sessionExpired) {
                            SignInView(app: app, mode: .again(email: user?.email))
                                .interactiveDismissDisabled()
                        }
                case .demo:
                    MainView(app: app)
                        .id(-1)
                }
            }
        }
    }
}
