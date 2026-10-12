import SwiftUI

/// The question field. Its button sends, or stops Teler while it works; +
/// attaches files, which show above the field.
struct ComposerView: View {
    @Binding var text: String
    let canSend: Bool
    var placeholder: LocalizedStringKey = "Ask about your data"
    /// While Teler works, a Stop button; nil when there's nothing to stop.
    var stop: (() -> Void)?
    var chips: [AttachmentChip] = []
    /// Opens Files, Photos and Camera; nil where files can't be attached.
    var attach: (() -> Void)?
    var removeChip: (UUID) -> Void = { _ in }
    var retryChip: (UUID) -> Void = { _ in }
    let send: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if !chips.isEmpty {
                AttachmentChips(chips: chips, remove: removeChip, retry: retryChip)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if let attach {
                    Button(action: attach) {
                        Image(systemName: "plus")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Palette.foreground)
                            .frame(width: 52, height: 52)
                    }
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Attach files")
                }
                field
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...6)
                .padding(.vertical, 11)
            if let stop {
                Button(action: stop) {
                    Image(systemName: "stop.fill")
                        .font(.footnote)
                        .foregroundStyle(Palette.background)
                        .frame(width: 44, height: 44)
                        .background(Palette.foreground, in: .circle)
                }
                .accessibilityLabel("Stop")
            } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.primaryForeground)
                        .frame(width: 44, height: 44)
                        .background(Palette.primary, in: .circle)
                }
                .disabled(!canSend)
                .opacity(canSend ? 1 : 0.45)
                .accessibilityLabel("Send")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
        .padding(.vertical, 4)
        .frame(minHeight: 52)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }
}
