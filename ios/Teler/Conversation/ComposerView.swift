import SwiftUI

/// The question field. Its button sends, or stops Teler while it works.
struct ComposerView: View {
    @Binding var text: String
    let canSend: Bool
    var placeholder: LocalizedStringKey = "Ask about your data"
    /// While Teler works, a Stop button; nil when there's nothing to stop.
    var stop: (() -> Void)?
    let send: () -> Void

    var body: some View {
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
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}
