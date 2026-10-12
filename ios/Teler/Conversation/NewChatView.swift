import SwiftUI
import TelerFeatures
import TelerKit

/// A new chat: what to ask, with questions to start from. The chat is created
/// when the first question is sent and then continues here as a conversation.
struct NewChatView: View {
    let app: AppModel
    private let workspace: Workspace
    private let question: String?
    @State private var model: NewChatModel
    @State private var started: NewChatModel.Started?
    /// Files to upload once the chat exists, with the first question.
    @State private var files: [(id: UUID, file: PickedFile)] = []
    @State private var attaching = false

    /// With `question`, the chat asks it right away.
    init(app: AppModel, workspace: Workspace, asking question: String? = nil) {
        self.app = app
        self.workspace = workspace
        self.question = question
        _model = State(initialValue: NewChatModel(workspace: workspace, language: app.language))
    }

    var body: some View {
        if let started {
            ConversationView(
                chat: started.chat, client: workspace.client, webURL: app.webURL(for: started.chat),
                language: app.language, firstQuestion: started.question, pendingFiles: files.map(\.file))
        } else {
            prompt
        }
    }

    private var prompt: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 8) {
                    TelerMark().frame(width: 48, height: 42)
                    Text("What do you want to know?")
                        .font(.title2.bold())
                        .foregroundStyle(Palette.foreground)
                        .padding(.top, 8)
                    Text("Teler answers from your organization's data.")
                        .font(.subheadline)
                        .foregroundStyle(Palette.mutedForeground)
                }
                if !model.suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(model.suggestions) { prompt in
                            StarterChip(label: prompt.label) { start(asking: prompt.label) }
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel("Try asking")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.background)
        .safeAreaInset(edge: .bottom) {
            ComposerView(
                text: $model.draft, canSend: model.canStart && !hasRefusals, chips: chips,
                attach: app.isDemo ? nil : { attaching = true },
                removeChip: { id in files.removeAll { $0.id == id } }
            ) { start() }
            .disabled(model.isStarting)
        }
        .sheet(isPresented: $attaching) {
            AttachSheet { picked in files += picked.map { (UUID(), $0) } }
        }
        .navigationTitle("New chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .alert(
            "Couldn't start a chat",
            isPresented: Binding(get: { model.problem != nil }, set: { if !$0 { model.problem = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.problem?.message ?? "")
        }
        .task {
            if let question, started == nil {
                start(asking: question)
            } else {
                await model.loadSuggestions()
            }
        }
    }

    /// Picked files wait here and upload with the first question; ones Teler
    /// won't take say why right away.
    private var chips: [AttachmentChip] {
        files.map { id, file in
            let refusal = UploadRules.refusal(name: file.name, size: file.size)
            return AttachmentChip(
                id: id, name: file.name, size: file.size, isImage: UploadRules.kind(of: file.name) == .image,
                status: refusal.map { .failed(AttachmentChip.message(.refused($0)), retryable: false) } ?? .waiting)
        }
    }

    private var hasRefusals: Bool {
        files.contains { UploadRules.refusal(name: $0.file.name, size: $0.file.size) != nil }
    }

    private func start(asking question: String? = nil) {
        Task {
            if let chat = await model.start(asking: question) { started = chat }
        }
    }
}
