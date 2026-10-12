import SwiftUI
import TelerFeatures
import TelerKit

struct ConversationView: View {
    @State private var model: ConversationModel
    @State private var askedFirstQuestion = false
    @Environment(AppModel.self) private var app
    private let client: TelerAPIClient
    private let webURL: URL?
    private let firstQuestion: String?

    /// `firstQuestion` is sent once when a new, empty chat opens. Teler answers in `language`.
    init(chat: ChatID, client: TelerAPIClient, webURL: URL?, language: String, firstQuestion: String? = nil) {
        _model = State(initialValue: ConversationModel(chat: chat, client: client, language: language))
        self.client = client
        self.webURL = webURL
        self.firstQuestion = firstQuestion
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if !app.connectivity.isOnline {
                    Banner(
                        systemImage: "wifi.slash",
                        text: model.isAnswering
                            ? String(localized: "You're offline. Teler keeps working on this, and the answer appears when you reconnect.")
                            : String(localized: "You're offline. Your question waits until you reconnect."))
                }
                ForEach(model.items) { item in
                    MessageView(item: item, context: context(for: item))
                }
                if let flow = model.questionFlow {
                    QuestionCard(model: model, flow: flow)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                if let problem = model.streamProblem {
                    Label(problem.message, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(Palette.warningInk)
                }
            }
            .padding()
        }
        .background(Palette.background)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.load() }
        .overlay { placeholder }
        .safeAreaInset(edge: .bottom) {
            ComposerView(
                text: $model.draft, canSend: model.canSend && app.connectivity.isOnline,
                placeholder: composerPlaceholder,
                stop: model.isAnswering ? { Task { await model.cancel() } } : nil
            ) {
                // While Teler waits for answers, typing answers the current question.
                if model.questionFlow != nil {
                    Task { await model.answerInOwnWords() }
                } else {
                    Task { await model.send() }
                }
            }
        }
        .navigationTitle(model.title ?? String(localized: "New chat"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if let webURL {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Link(destination: webURL) {
                            Label("Open on the web", systemImage: "safari")
                        }
                        ShareLink(item: webURL) {
                            Label("Share link", systemImage: "square.and.arrow.up")
                        }
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                }
            }
        }
        .task {
            await model.load()
            if let firstQuestion, !askedFirstQuestion, model.items.isEmpty {
                askedFirstQuestion = true
                await model.ask(firstQuestion)
            }
        }
        .onDisappear { model.stop() }
        .onChange(of: model.draft) { _, draft in
            if !draft.isEmpty { model.touchQuestion() }
        }
        .animation(.snappy, value: model.questionFlow?.call.toolCallID)
    }

    private var composerPlaceholder: LocalizedStringKey {
        if model.questionFlow != nil { return "Or answer in your own words…" }
        return model.items.isEmpty ? "Ask about your data" : "Ask a follow-up"
    }

    private func context(for item: ConversationModel.Item) -> AnswerContext {
        let isLatest = item.id == model.items.last?.id
        return AnswerContext(
            chat: model.chat, client: client, webURL: webURL, isLatest: isLatest,
            isOffline: !app.connectivity.isOnline, progress: item.isStreaming ? model.progress : nil,
            ask: { question in Task { await model.ask(question) } },
            retry: model.lastQuestion.map { question in { Task { await model.ask(question) } } },
            editQuestion: model.lastQuestion.map { question in { model.draft = question } },
            questionStatuses: model.questionStatuses)
    }

    @ViewBuilder private var placeholder: some View {
        switch model.phase {
        case .loading where model.items.isEmpty:
            ProgressView()
        case .failed(let problem):
            ContentUnavailableView {
                Label("This chat didn't load", systemImage: "exclamationmark.bubble")
            } description: {
                Text(problem.message)
            } actions: {
                Button("Try again") { Task { await model.load() } }
                    .buttonStyle(.glass)
            }
        case .ready where model.items.isEmpty:
            ContentUnavailableView(
                "Ask anything about your data", systemImage: "sparkle.magnifyingglass",
                description: Text("Teler finds the right tables, runs the analysis and explains the result."))
        default:
            EmptyView()
        }
    }
}
