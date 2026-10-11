import SwiftUI
import TelerKit

/// A person's initials in a circle.
struct Avatar: View {
    enum Style {
        case primary
        case alternate
    }

    let initials: String
    var style = Style.primary
    var size: CGFloat = 32

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(style == .primary ? Palette.avatarInk : Palette.avatarAlternateInk)
            .frame(width: size, height: size)
            .background(style == .primary ? Palette.avatar : Palette.avatarAlternate, in: .circle)
            .accessibilityHidden(true)
    }

    /// Up to two initials from the name, or the email's first letter.
    static func initials(for user: SignedInUser) -> String {
        let words = (user.name ?? "").split(whereSeparator: \.isWhitespace)
        let letters = words.prefix(2).compactMap(\.first)
        if !letters.isEmpty { return String(letters).uppercased() }
        return user.email?.first.map { String($0).uppercased() } ?? "?"
    }
}

/// A symbol, or Teler's mark, on a small rounded tile leading a row.
struct IconTile<Content: View>: View {
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 30
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Palette.foreground)
            .frame(width: side, height: side)
            .background(Palette.fill, in: .rect(cornerRadius: side * 0.27))
            .accessibilityHidden(true)
    }
}

extension IconTile where Content == Image {
    init(systemImage: String) {
        self.init { Image(systemName: systemImage) }
    }
}

/// A list section's title, with a count when it has one.
struct SectionTitle: View {
    let title: LocalizedStringKey
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Palette.foreground)
            if let count {
                Text(count, format: .number)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// Places a list section's header as the design does: 4 points in from the
    /// cards' edge, close above them.
    func sectionHeaderInsets() -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 8, trailing: 4))
    }
}

/// A chat in a list: its title and when it last changed.
struct ChatRow: View {
    let chat: ChatSummary
    var time: String?
    /// The part of the title to show in bold, such as a search's text.
    var highlight: String?

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemImage: "bubble.left")
            Text(title)
                .font(.body)
                .foregroundStyle(Palette.foreground)
                .lineLimit(1)
                .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
            Spacer(minLength: 8)
            if let time {
                Text(time)
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .frame(minHeight: 44)
    }

    private var title: AttributedString {
        var title = AttributedString(chat.title ?? String(localized: "Untitled chat"))
        if let highlight, !highlight.isEmpty,
            let range = title.range(of: highlight, options: [.caseInsensitive, .diacriticInsensitive])
        {
            title[range].font = .body.weight(.semibold)
        }
        return title
    }
}

/// A question to start a chat with.
struct StarterChip: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Palette.foreground)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(minHeight: 44)
                .background(Palette.fill, in: .rect(cornerRadius: 22))
        }
        .buttonStyle(.plain)
    }
}

/// When a chat last changed, as the lists show it.
enum ChatTime {
    /// `inDaySections` drops "Yesterday" where a section already says it.
    static func label(_ date: Date?, now: Date = .now, inDaySections: Bool = false) -> String? {
        guard let date else { return nil }
        let calendar = Calendar.current
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        let days =
            calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now))
            .day ?? 0
        if days == 1 {
            return inDaySections
                ? date.formatted(date: .omitted, time: .shortened) : String(localized: "Yesterday")
        }
        if days < 7 { return date.formatted(.dateTime.weekday(.abbreviated)) }
        if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            return date.formatted(.dateTime.day().month(.abbreviated))
        }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }
}
