import SwiftUI
import TelerFeatures
import TelerKit

struct ChatListView: View {
    let app: AppModel
    @State private var model: ChatListModel
    @State private var path: [ChatID] = []
    @State private var firstQuestions: [ChatID: String] = [:]
    @State private var routed = false

    init(app: AppModel) {
        self.app = app
        _model = State(initialValue: ChatListModel(client: app.client))
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("Chats")
                .navigationDestination(for: ChatID.self) { chat in
                    ConversationView(
                        chat: chat, client: app.client, webURL: app.webURL(for: chat),
                        firstQuestion: firstQuestions[chat])
                }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button("New chat", systemImage: "square.and.pencil") {
                            Task {
                                if let chat = await model.createChat() { path.append(chat) }
                            }
                        }
                        .disabled(model.isCreating)
                    }
                }
                .alert(
                    "Couldn't start a chat",
                    isPresented: Binding(
                        get: { model.creationProblem != nil },
                        set: { if !$0 { model.creationProblem = nil } })
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(model.creationProblem?.message ?? "")
                }
        }
        .task {
            await model.load()
            await openLaunchRoute()
        }
        .onChange(of: path) { _, newPath in
            // Returning to the list shows titles and order changed by the chat.
            if newPath.isEmpty { Task { await model.load() } }
        }
    }

    private func openLaunchRoute() async {
        guard !routed, let route = DebugRoute.atLaunch else { return }
        routed = true
        switch route {
        case .chat(let chat):
            path.append(chat)
        case .ask(let question):
            guard let chat = await model.createChat() else { return }
            firstQuestions[chat] = question
            path.append(chat)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
        case .failed(let problem):
            ContentUnavailableView {
                Label("Chats didn't load", systemImage: "wifi.exclamationmark")
            } description: {
                Text(problem.message)
            } actions: {
                Button("Try again") { Task { await model.load() } }
            }
        case .loaded:
            List {
                if app.isDemo {
                    Section {
                        Label(
                            "You're looking at sample chats. Signing in to your workspace comes next.",
                            systemImage: "sparkles"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }
                Section {
                    ForEach(model.chats) { chat in
                        NavigationLink(value: chat.id) { ChatRow(chat: chat) }
                    }
                }
            }
            .overlay {
                if model.chats.isEmpty {
                    ContentUnavailableView(
                        "No chats yet", systemImage: "bubble.left.and.text.bubble.right",
                        description: Text("Start one to ask Teler about your data."))
                }
            }
            .refreshable { await model.load() }
        }
    }
}

private struct ChatRow: View {
    let chat: ChatSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(chat.title ?? String(localized: "Untitled chat"))
                .font(.body)
                .lineLimit(2)
            if let updatedAt = chat.updatedAt {
                Text(updatedAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
