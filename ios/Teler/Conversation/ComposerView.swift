import SwiftUI

/// The question field, with an amber send button once there's something to send.
struct ComposerView: View {
    @Binding var text: String
    let canSend: Bool
    let send: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Ask about your data", text: $text, axis: .vertical)
                .lineLimit(1...6)
                .padding(.vertical, 11)
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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
