import SwiftUI
import TelerFeatures
import TelerKit

struct ConversationView: View {
    @State private var model: ConversationModel
    @State private var askedFirstQuestion = false
    private let webURL: URL?
    private let firstQuestion: String?

    /// `firstQuestion` is sent once when a new, empty chat opens.
    init(chat: ChatID, client: TelerAPIClient, webURL: URL?, firstQuestion: String? = nil) {
        _model = State(initialValue: ConversationModel(chat: chat, client: client))
        self.webURL = webURL
        self.firstQuestion = firstQuestion
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                ForEach(model.items) { item in
                    MessageView(item: item, webURL: webURL)
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
            ComposerView(text: $model.draft, canSend: model.canSend) {
                Task { await model.send() }
            }
        }
        .navigationTitle(model.title ?? String(localized: "New chat"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .task {
            await model.load()
            if let firstQuestion, !askedFirstQuestion, model.items.isEmpty {
                askedFirstQuestion = true
                model.draft = firstQuestion
                await model.send()
            }
        }
        .onDisappear { model.stop() }
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
