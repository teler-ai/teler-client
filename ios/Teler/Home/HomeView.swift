import SwiftUI
import TelerFeatures
import TelerKit

/// Today: a greeting, then where the member left off, or for a new member
/// questions to start from.
struct HomeView: View {
    let app: AppModel
    let open: (Route) -> Void
    let showChats: () -> Void
    @State private var model: HomeModel

    init(app: AppModel, workspace: Workspace, open: @escaping (Route) -> Void, showChats: @escaping () -> Void) {
        self.app = app
        self.open = open
        self.showChats = showChats
        _model = State(initialValue: HomeModel(workspace: workspace, language: app.language))
    }

    var body: some View {
        List {
            switch model.phase {
            case .loading:
                placeholder
            case .failed(let problem):
                Section {
                    ProblemRow(problem: problem) { Task { await model.load() } }
                } header: {
                    header(nil)
                }
                .listRowBackground(Palette.card)
            case .loaded where model.isNewMember:
                suggestions
            case .loaded:
                recent
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle("Today")
        .toolbar { MainToolbar(app: app) { open(.newChat) } }
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    /// The date and the greeting, then the first section's title, close
    /// together as the design sets them. The date is content rather than a
    /// navigation subtitle, which shrinks the large title.
    private func header(_ title: LocalizedStringKey?, seeAll: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 10) {
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
                greeting
            }
            if let title {
                HStack(alignment: .firstTextBaseline) {
                    SectionTitle(title: title)
                    Spacer()
                    if seeAll {
                        Button("See all", action: showChats)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Palette.primaryInk)
                            .frame(minHeight: 44)
                    }
                }
                .padding(.bottom, -6)
            }
        }
        .textCase(nil)
        .sectionHeaderInsets()
    }

    private var greeting: some View {
        var text = AttributedString(hello)
        text.font = .body.weight(.semibold)
        if let more = greetingDetail { text += AttributedString(" " + more) }
        return Text(text)
            .font(.body)
            .foregroundStyle(Palette.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hello: String {
        var name: String?
        if case .signedIn(let user?) = app.session.state { name = user.firstName }
        return switch (DayPart(.now), name) {
        case (.morning, let name?): String(localized: "Good morning, \(name).")
        case (.afternoon, let name?): String(localized: "Good afternoon, \(name).")
        case (.evening, let name?): String(localized: "Good evening, \(name).")
        case (.morning, nil): String(localized: "Good morning.")
        case (.afternoon, nil): String(localized: "Good afternoon.")
        case (.evening, nil): String(localized: "Good evening.")
        }
    }

    private var greetingDetail: String? {
        if app.isDemo { return String(localized: "You're exploring sample data.") }
        if model.isNewMember {
            return String(localized: "Ask a first question about your data, or start from a suggestion.")
        }
        return nil
    }

    private var recent: some View {
        Section {
            ForEach(model.recent) { chat in
                Button {
                    open(.chat(chat.id))
                } label: {
                    ChatRow(chat: chat, time: ChatTime.label(chat.updatedAt))
                }
            }
        } header: {
            header("Continue", seeAll: true)
        }
        .listRowBackground(Palette.card)
    }

    private var suggestions: some View {
        Section {
            ForEach(model.suggestions) { prompt in
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
            header(model.suggestions.isEmpty ? nil : "Try asking")
        }
        .listRowBackground(Palette.card)
    }

    private static let placeholderChat = ChatSummary(
        id: ChatID(rawValue: "chat_" + String(repeating: "0", count: 26))!, title: "A chat title of some length")

    private var placeholder: some View {
        Section {
            ForEach(0..<HomeModel.recentCount, id: \.self) { _ in
                ChatRow(chat: Self.placeholderChat, time: "9:41")
                    .redacted(reason: .placeholder)
            }
        } header: {
            header("Continue")
        }
        .listRowBackground(Palette.card)
        .accessibilityLabel("Loading")
    }
}

/// Why something didn't load, with a way to try again.
struct ProblemRow: View {
    let problem: Problem
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(problem.message, systemImage: problem == .offline ? "wifi.slash" : "exclamationmark.triangle")
                .foregroundStyle(Palette.foreground)
            Button("Try again", action: retry)
                .buttonStyle(.glass)
        }
        .padding(.vertical, 6)
    }
}
