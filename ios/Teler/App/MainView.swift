import SwiftUI
import TelerFeatures
import TelerKit

enum AppTab: Hashable {
    case home
    case chats
    case search
}

/// Where a tab's navigation stack can go.
enum Route: Hashable {
    /// A chat, asking `question` first when it's new.
    case chat(ChatID, firstQuestion: String? = nil)
    /// A chat that's created when the first question is asked.
    case newChat
    /// A new chat asking `question` right away.
    case ask(String)
}

/// The app for an account or the sample: Today, Chats and search, each tab
/// with its own navigation stack.
struct MainView: View {
    let app: AppModel
    @State private var workspace: Workspace
    @State private var tab = AppTab.home
    @State private var paths: [AppTab: [Route]] = [:]
    @State private var routed = false
    @State private var searchText = ""

    init(app: AppModel) {
        self.app = app
        _workspace = State(initialValue: Workspace(client: app.client))
    }

    var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                stack(.home) { HomeView(app: app, workspace: workspace, open: open, showChats: { tab = .chats }) }
            }
            Tab("Chats", systemImage: "bubble.left", value: AppTab.chats) {
                stack(.chats) { ChatListView(app: app, workspace: workspace, open: open) }
            }
            Tab(value: AppTab.search, role: .search) {
                stack(.search) { SearchView(app: app, workspace: workspace, query: searchText, open: open) }
            }
        }
        // The search tab's field; on the TabView, iOS places it for that tab.
        .searchable(text: $searchText, prompt: "Search or ask")
        .task { await openLaunchRoute() }
    }

    private func stack(_ tab: AppTab, @ViewBuilder root: () -> some View) -> some View {
        NavigationStack(path: path(tab)) {
            root().navigationDestination(for: Route.self) { route in
                destination(route)
            }
        }
    }

    @ViewBuilder private func destination(_ route: Route) -> some View {
        switch route {
        case .chat(let chat, let question):
            ConversationView(
                chat: chat, client: workspace.client, webURL: app.webURL(for: chat), firstQuestion: question)
        case .newChat:
            NewChatView(app: app, workspace: workspace)
        case .ask(let question):
            NewChatView(app: app, workspace: workspace, asking: question)
        }
    }

    private func path(_ tab: AppTab) -> Binding<[Route]> {
        Binding(get: { paths[tab] ?? [] }, set: { paths[tab] = $0 })
    }

    /// Opens `route` on top of the current tab.
    private func open(_ route: Route) {
        paths[tab, default: []].append(route)
    }

    private func openLaunchRoute() async {
        guard !routed, let route = DebugRoute.atLaunch else { return }
        routed = true
        switch route {
        case .tab(let launchTab):
            tab = launchTab
        case .chat(let chat):
            // Switch tabs first, then open the chat, as a person would.
            tab = .chats
            try? await Task.sleep(for: .milliseconds(500))
            paths[.chats] = [.chat(chat)]
        case .ask(let question):
            paths[.home] = [.ask(question)]
        case .newChat:
            paths[.home] = [.newChat]
        case .search(let text):
            tab = .search
            searchText = text
        case .screen:
            break
        }
    }
}

/// The top-level screens' toolbar: a new chat, when the screen offers one, and the account.
struct MainToolbar: ToolbarContent {
    let app: AppModel
    var compose: (() -> Void)?

    var body: some ToolbarContent {
        if let compose {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "square.and.pencil", action: compose)
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
        }
        ToolbarItem(placement: .topBarTrailing) {
            AccountMenu(app: app)
        }
    }
}

/// The member's initials, opening the account's actions.
struct AccountMenu: View {
    let app: AppModel

    var body: some View {
        Menu {
            if case .signedIn(let user?) = app.session.state {
                Section(user.name ?? user.email ?? "") {
                    if let email = user.email, user.name != nil { Text(email) }
                }
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task { await app.session.signOut() }
                }
            } else if app.isDemo {
                Section("You're exploring sample data.") {
                    Button("Sign in", systemImage: "person.crop.circle") {
                        Task { await app.session.signOut() }
                    }
                }
            }
        } label: {
            if case .signedIn(let user?) = app.session.state {
                Avatar(initials: Avatar.initials(for: user))
            } else {
                Image(systemName: "person.crop.circle")
            }
        }
        .accessibilityLabel("Account")
    }
}
