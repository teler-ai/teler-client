import SwiftUI
import TelerFeatures
import TelerKit

/// The search tab: "Search or ask". Typing finds chats by title, and the first
/// row asks Teler the same words in a new chat. The field is the tab bar's.
struct SearchView: View {
    let app: AppModel
    let query: String
    let open: (Route) -> Void
    private let workspace: Workspace
    @State private var recent: ChatListModel
    @State private var search: ChatSearchModel
    @State private var suggestions: [StarterPrompt] = []

    init(app: AppModel, workspace: Workspace, query: String, open: @escaping (Route) -> Void) {
        self.app = app
        self.query = query
        self.open = open
        self.workspace = workspace
        _recent = State(initialValue: ChatListModel(workspace: workspace, limit: 5))
        _search = State(initialValue: ChatSearchModel(workspace: workspace))
    }

    var body: some View {
        Group {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                start
            } else {
                ChatSearchResults(query: query, search: search, open: open, canAsk: !app.isSample)
            }
        }
        .navigationTitle("Search")
        .task(id: query) { await search.search(query) }
        .toolbar { MainToolbar(app: app) }
        .task {
            await recent.load()
            suggestions = await workspace.starterPrompts(language: app.language)
        }
    }

    private var start: some View {
        List {
            if !suggestions.isEmpty, !app.isSample {
                Section {
                    ForEach(suggestions) { prompt in
                        Button {
                            open(.ask(prompt.label))
                        } label: {
                            Label {
                                Text(prompt.label).foregroundStyle(Palette.foreground)
                            } icon: {
                                Image(systemName: "sparkles").foregroundStyle(Palette.primaryInk)
                            }
                        }
                    }
                } header: {
                    header("Try asking")
                }
                .listRowBackground(Palette.card)
            }
            if !recent.chats.isEmpty {
                Section {
                    ForEach(recent.chats) { chat in
                        Button {
                            open(.chat(chat.id))
                        } label: {
                            ChatRow(chat: chat, time: ChatTime.label(chat.updatedAt))
                        }
                    }
                } header: {
                    header("Recent chats")
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
    }

    private func header(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.mutedForeground)
            .textCase(nil)
            .sectionHeaderInsets()
    }
}
