import SwiftUI
import TelerKit
import WebKit

/// Cloudflare's Turnstile check, which Teler's sign-in can require. It has no
/// native SDK, so it runs in a web view whose page claims Teler's origin, the
/// host the site key is issued for. Nothing else loads in this web view.
struct CaptchaSheet: View {
    let siteKey: String
    let origin: TelerOrigin
    let solved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var failed = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Confirm you're a person to continue.")
                    .foregroundStyle(.secondary)
                if let url = URL(string: origin.description) {
                    TurnstileWebView(siteKey: siteKey, origin: url) { token in
                        solved(token)
                    } failed: {
                        failed = true
                    }
                    .frame(height: 80)
                }
                if failed {
                    Label("The check didn't load. Close this and try again.", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Security check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

private struct TurnstileWebView: UIViewRepresentable {
    let siteKey: String
    let origin: URL
    let solved: (String) -> Void
    let failed: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(solved: solved, failed: failed) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "turnstile")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.loadHTMLString(page, baseURL: origin)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "turnstile")
    }

    /// `siteKey` is limited to letters, digits, `_` and `-` by TelerKit.
    private var page: String {
        """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        <style>html,body{margin:0;background:transparent}body{display:flex;justify-content:center}</style>
        </head><body>
        <div class="cf-turnstile" data-sitekey="\(siteKey)" data-theme="auto"
          data-callback="solved" data-error-callback="failed" data-expired-callback="failed"></div>
        <script>
        function solved(token) { window.webkit.messageHandlers.turnstile.postMessage({ token: token }) }
        function failed() { window.webkit.messageHandlers.turnstile.postMessage({ failed: true }) }
        </script>
        </body></html>
        """
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        private let solved: (String) -> Void
        private let failed: () -> Void

        init(solved: @escaping (String) -> Void, failed: @escaping () -> Void) {
            self.solved = solved
            self.failed = failed
        }

        func userContentController(
            _ controller: WKUserContentController, didReceive message: WKScriptMessage
        ) {
            if let body = message.body as? [String: Any], let token = body["token"] as? String,
                (1...4096).contains(token.count)
            {
                solved(token)
            } else {
                failed()
            }
        }
    }
}
