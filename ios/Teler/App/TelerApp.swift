import SwiftUI
import TelerFeatures

@main
struct TelerApp: App {
    @State private var app = AppModel()

    init() {
        Typeface.setUp()
    }

    var body: some Scene {
        WindowGroup {
            RootView(app: app)
                .tint(Palette.primaryInk)
        }
    }
}

/// Signs in first, then shows the app for the account or the demo.
struct RootView: View {
    let app: AppModel

    var body: some View {
        Group {
            switch app.session.state {
            case .restoring:
                ProgressView()
            case .signedOut:
                SignInView(app: app)
            case .signedIn, .demo:
                MainView(app: app)
                    .id(app.isDemo)
            }
        }
        .task {
            if DebugRoute.startsInDemo {
                app.session.startDemo()
            } else {
                await app.session.restore()
            }
        }
    }
}
