import SwiftUI
import TelerFeatures
import TelerKit

/// Today: a greeting, then where the member left off, or for a new member
/// questions to start from.
struct HomeView: View {
    let app: AppModel
    let needsYou: NeedsYouModel
    let open: (Route) -> Void
    let showChats: () -> Void
    @State private var model: HomeModel
    @State private var showsAllNeeds = false

    init(
        app: AppModel, workspace: Workspace, needsYou: NeedsYouModel, open: @escaping (Route) -> Void,
        showChats: @escaping () -> Void
    ) {
        self.app = app
        self.needsYou = needsYou
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
                if !app.isDemo { needsSection }
            case .loaded:
                if hasNeeds { needsSection }
                recent
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle("Today")
        .toolbar { MainToolbar(app: app) { open(.newChat) } }
        .task { await model.load() }
        .task { await needsYou.load() }
        .refreshable {
            async let home: Void = model.load()
            async let needs: Void = needsYou.load()
            _ = await (home, needs)
        }
    }

    private var hasNeeds: Bool { !needsYou.items.isEmpty || !needsYou.closed.isEmpty }

    /// What waits on the member, at most three unless they ask for more.
    private var needsSection: some View {
        Section {
            if hasNeeds {
                ForEach(showsAllNeeds ? needsYou.items : needsYou.waiting) { item in
                    NeedsYouRow(
                        item: item, model: needsYou, isOnline: app.connectivity.isOnline, canAct: !app.isSample,
                        open: open)
                }
                if needsYou.items.count > NeedsYouModel.limit, !showsAllNeeds {
                    Button("\(needsYou.items.count - NeedsYouModel.limit) more") { showsAllNeeds = true }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.primaryInk)
                }
                ForEach(needsYou.closed) { finding in
                    ClosedAlertRow(finding: finding, open: open)
                }
            } else {
                Label {
                    Text("Agent results and access requests land here. Agents are set up on the web.")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                } icon: {
                    Image(systemName: "clock").foregroundStyle(Palette.mutedForeground)
                }
            }
        } header: {
            if model.isNewMember {
                SectionTitle(title: "Needs you").sectionHeaderInsets()
            } else {
                header("Needs you", count: needsYou.items.isEmpty ? nil : needsYou.items.count)
            }
        }
        .listRowBackground(Palette.card)
    }

    /// The date and the greeting, then the first section's title, close
    /// together as the design sets them. The date is content rather than a
    /// navigation subtitle, which shrinks the large title.
    /// `greets` is false below the first section, which carries the date and greeting.
    private func header(_ title: LocalizedStringKey?, count: Int? = nil, seeAll: Bool = false, greets: Bool = true)
        -> some View
    {
        VStack(alignment: .leading, spacing: 22) {
            if greets {
                VStack(alignment: .leading, spacing: 10) {
                    Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                    greeting
                }
            }
            if let title {
                HStack(alignment: .firstTextBaseline) {
                    SectionTitle(title: title, count: count)
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
        switch needsYou.items.count {
        case 0: return nil
        case 1: return String(localized: "One thing needs you.")
        case let count: return String(localized: "\(count) things need you.")
        }
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
            header("Continue", seeAll: true, greets: !hasNeeds)
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
