import SwiftUI

@main
struct TelerApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            ChatListView(app: app)
        }
    }
}
