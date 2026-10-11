import SwiftUI

/// How a field's box draws its edge.
enum FieldLook {
    case normal
    case focused
    /// The value was rejected.
    case error
}

/// A text field's box: a card with a hairline border, a 2-point ink ring when
/// focused and a red one when its value was rejected.
struct FieldBox<Content: View>: View {
    var look = FieldLook.normal
    var height: CGFloat = 52
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 8) {
            content
        }
        .font(.body)
        .foregroundStyle(Palette.foreground)
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .frame(minHeight: height)
        .background(Palette.card, in: .rect(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(ring, lineWidth: look == .normal ? 1 : 2)
        }
    }

    private var ring: Color {
        switch look {
        case .normal: Palette.border
        case .focused: Palette.primaryInk
        case .error: Palette.destructiveInk
        }
    }
}

/// A field's label, above it: translations run long, so never beside it.
struct FieldLabel: View {
    let text: LocalizedStringKey

    init(_ text: LocalizedStringKey) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.foreground)
            .padding(.horizontal, 2)
    }
}

/// Why a value was rejected, under its field.
struct FieldError: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.subheadline)
            .foregroundStyle(Palette.destructiveInk)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The screen's main action: an amber capsule with dark text, faded until it
/// can run. While working it keeps its color and shows progress.
struct PrimaryButton: View {
    let title: LocalizedStringKey
    var isWorking = false
    var workingTitle: LocalizedStringKey?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isWorking { ProgressView().tint(Palette.primaryForeground) }
                Text(isWorking ? (workingTitle ?? title) : title)
            }
        }
        .buttonStyle(PrimaryCapsuleStyle(isWorking: isWorking))
    }
}

/// The primary button's look, for buttons with their own label.
struct PrimaryCapsuleStyle: ButtonStyle {
    var isWorking = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Palette.primaryForeground)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Palette.primary, in: .capsule)
            .opacity(isEnabled || isWorking ? (configuration.isPressed ? 0.8 : 1) : 0.38)
            .contentShape(.capsule)
    }
}

/// A symbol in a soft circle, heading a focused screen such as two-factor.
struct IconCircle: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.title3)
            .foregroundStyle(Palette.foreground)
            .frame(width: 48, height: 48)
            .background(Palette.fill, in: .circle)
            .accessibilityHidden(true)
    }
}

/// A short notice across the top of a screen, such as being offline.
struct Banner: View {
    let systemImage: String
    let text: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.subheadline)
            .foregroundStyle(Palette.foreground)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
    }
}
