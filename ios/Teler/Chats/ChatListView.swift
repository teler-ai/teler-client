import SwiftUI
import TelerFeatures
import TelerKit

/// The organization's chats by day, searchable by title.
struct ChatListView: View {
    let app: AppModel
    let open: (Route) -> Void
    @State private var model: ChatListModel
    @State private var search: ChatSearchModel
    @State private var query = ""

    init(app: AppModel, workspace: Workspace, open: @escaping (Route) -> Void) {
        self.app = app
        self.open = open
        _model = State(initialValue: ChatListModel(workspace: workspace))
        _search = State(initialValue: ChatSearchModel(workspace: workspace))
    }

    var body: some View {
        content
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle("Chats")
            .searchable(text: $query, prompt: "Search chats")
            .task(id: query) { await search.search(query) }
            .toolbar { MainToolbar(app: app) { open(.newChat) } }
            .task { await model.load() }
            .refreshable { await model.load() }
    }

    @ViewBuilder private var content: some View {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            ChatSearchResults(query: query, search: search, open: open)
        } else {
            switch model.phase {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let problem):
                ContentUnavailableView {
                    Label("Chats didn't load", systemImage: problem == .offline ? "wifi.slash" : "exclamationmark.bubble")
                } description: {
                    Text(problem.message)
                } actions: {
                    Button("Try again") { Task { await model.load() } }
                        .buttonStyle(.glass)
                }
            case .loaded where model.chats.isEmpty:
                ContentUnavailableView {
                    Label("No chats yet", systemImage: "bubble.left")
                } description: {
                    Text("Ask a question about your data. Every conversation with Teler stays here, on the web too.")
                } actions: {
                    Button("New chat", systemImage: "square.and.pencil") { open(.newChat) }
                        .buttonStyle(.glassProminent)
                }
            case .loaded:
                list
            }
        }
    }

    private var list: some View {
        List {
            if !app.connectivity.isOnline, !app.isDemo {
                Banner(systemImage: "wifi.slash", text: app.offlineNotice(.chats))
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            ForEach(ChatSection.group(model.chats)) { section in
                Section {
                    ForEach(section.chats) { chat in
                        Button {
                            open(.chat(chat.id))
                        } label: {
                            ChatRow(chat: chat, time: ChatTime.label(chat.updatedAt, inDaySections: true))
                        }
                    }
                } header: {
                    Text(section.period.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.mutedForeground)
                        .textCase(nil)
                        .sectionHeaderInsets()
                }
                .listRowBackground(Palette.card)
            }
        }
        .listStyle(.insetGrouped)
    }
}

extension ChatSection.Period {
    var title: String {
        switch self {
        case .today: String(localized: "Today")
        case .yesterday: String(localized: "Yesterday")
        case .previousSevenDays: String(localized: "Previous 7 days")
        case .previousThirtyDays: String(localized: "Previous 30 days")
        case .month(let year, let month):
            Calendar.current.date(from: DateComponents(year: year, month: month)).map {
                $0.formatted(
                    Calendar.current.component(.year, from: .now) == year
                        ? .dateTime.month(.wide) : .dateTime.month(.wide).year())
            } ?? ""
        case .undated: String(localized: "Earlier")
        }
    }
}

/// What a search finds: asking Teler first, then the chats whose title matches.
struct ChatSearchResults: View {
    let query: String
    let search: ChatSearchModel
    let open: (Route) -> Void
    /// False in the read-only sample, where nothing starts a new chat.
    var canAsk = true

    private var text: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        List {
            if canAsk { askRow }
            results
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
    }

    private var askRow: some View {
        Section {
            Button {
                open(.ask(text))
            } label: {
                HStack(spacing: 12) {
                    IconTile { TelerMark().padding(6) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Ask Teler: “\(text)”")
                            .font(.body)
                            .foregroundStyle(Palette.foreground)
                            .lineLimit(2)
                        Text("Starts a new chat")
                            .font(.subheadline)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.tertiary)
                }
            }
        }
        .listRowBackground(Palette.card)
    }

    @ViewBuilder private var results: some View {
        switch search.phase {
        case .found where !search.results.isEmpty:
            Section {
                ForEach(search.results) { chat in
                    Button {
                        open(.chat(chat.id))
                    } label: {
                        ChatRow(chat: chat, time: ChatTime.label(chat.updatedAt), highlight: text)
                    }
                }
            } header: {
                Text("Chats")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
                    .textCase(nil)
                    .sectionHeaderInsets()
            }
            .listRowBackground(Palette.card)
        case .found:
            Section {
                ContentUnavailableView {
                    Label("No chats match “\(text)”", systemImage: "magnifyingglass")
                } description: {
                    Text("Check the spelling, or ask Teler to work it out from your data.")
                }
            }
            .listRowBackground(Color.clear)
        case .failed(let problem):
            Section {
                Label(problem.message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
            }
            .listRowBackground(Color.clear)
        case .idle, .searching:
            EmptyView()
        }
    }
}
