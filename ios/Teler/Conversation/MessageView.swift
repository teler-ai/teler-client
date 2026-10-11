import SwiftUI
import TelerFeatures
import TelerKit

struct MessageView: View {
    let item: ConversationModel.Item
    let webURL: URL?

    var body: some View {
        if item.role == .user {
            HStack {
                Spacer(minLength: 48)
                Text(userText)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.tint.opacity(0.15), in: .rect(cornerRadius: 20))
                    .textSelection(.enabled)
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    switch part {
                    case .field(let field):
                        ContentFieldView(field: field)
                    case .unsupported(let count):
                        UnsupportedPartsView(count: count, webURL: webURL)
                    }
                }
                if item.isStreaming && item.content.isEmpty {
                    ProgressView().controlSize(.small)
                        .accessibilityLabel("Teler is working on the answer")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var userText: String {
        item.content.compactMap { field in
            if case .text(let text) = field { return text }
            return nil
        }.joined(separator: "\n")
    }

    private enum Part {
        case field(ContentField)
        case unsupported(Int)
    }

    /// Consecutive parts the app can't show yet collapse into one notice.
    private var parts: [Part] {
        var parts: [Part] = []
        for field in item.content {
            if case .unknown = field {
                if case .unsupported(let count)? = parts.last {
                    parts[parts.count - 1] = .unsupported(count + 1)
                } else {
                    parts.append(.unsupported(1))
                }
            } else {
                parts.append(.field(field))
            }
        }
        return parts
    }
}

private struct UnsupportedPartsView: View {
    let count: Int
    let webURL: URL?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "rectangle.on.rectangle")
                .foregroundStyle(.secondary)
            Text(
                count == 1
                    ? String(localized: "Part of this answer shows only on the web for now.")
                    : String(localized: "\(count) parts of this answer show only on the web for now.")
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let webURL {
                Link("Open", destination: webURL).font(.footnote.weight(.semibold))
            }
        }
        .padding(12)
        .background(.fill.quaternary, in: .rect(cornerRadius: 14))
    }
}
