import SwiftUI
import TelerKit

/// A chart, table or metric from an answer, drawn natively from Teler's chart
/// format. The part names it; its spec and data are fetched by slug. Tapping
/// a chart opens it larger, to read every value.
struct ChartCard: View {
    let chart: ChatID
    let reference: ChartReference
    let client: TelerAPIClient
    /// While the answer is still written, the data can arrive a little after the part.
    var isStreaming = false
    var webURL: URL?
    @State private var spec: ChartSpec?
    @State private var failed = false
    @State private var showsDetail = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(spec?.title ?? reference.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.foreground)
                    if let detail = spec?.description ?? reference.description {
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                Spacer(minLength: 8)
                if opensDetail {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.tertiary)
                        .accessibilityHidden(true)
                }
            }
            if let spec {
                ChartBody(spec: spec, webURL: webURL)
            } else if failed {
                Label("This chart didn't load.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Palette.warningInk)
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Palette.fill)
                    .frame(height: 180)
                    .accessibilityLabel("Loading the chart")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Palette.border))
        .contentShape(.rect(cornerRadius: 20))
        .onTapGesture { if opensDetail { showsDetail = true } }
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Open the chart") { if opensDetail { showsDetail = true } }
        .sheet(isPresented: $showsDetail) {
            if let spec { ChartDetailView(spec: spec, title: reference.title) }
        }
        .task(id: reference.slug) { await load() }
    }

    private var opensDetail: Bool {
        spec.map(ChartBody.opensDetail) ?? false
    }

    private func load() async {
        // Like the web app, wait up to 30 seconds for data that lags its part.
        for attempt in 0..<(isStreaming ? 15 : 2) {
            do {
                spec = try await client.chartSpec(chat: chart, slug: reference.slug)
                return
            } catch is CancellationError {
                return
            } catch {
                if attempt > 0 || !isStreaming { failed = attempt > 0 }
                try? await Task.sleep(for: .seconds(2))
            }
        }
        failed = true
    }
}
