import Foundation
import Testing

@testable import TelerFeatures
@testable import TelerKit

/// Organizations, credits and devices, as the web's account routes send them.
@MainActor @Suite struct SettingsTests {
    private let org = "org_01jczpznh32py20pd8y10ef9cq"
    private let other = "org_01jd2f9c4h6p2r8z3y5v7n1gqd"

    private func ok(_ body: String) -> StubTransport.Reply {
        .response(status: 200, chunks: [body])
    }

    @Test func readsOrganizationsCreditsAndDevicesWithoutTokens() async throws {
        let transport = StubTransport([
            ok(#"{"success":true,"data":[{"id":"\#(org)","name":"Roure Coffee","slug":"roure","role":"owner","plan":"professional","creditMetering":"metered","isDefault":true},{"id":"\#(other)","name":"Fira","role":"member"}]}"#),
            ok(#"{"activeOrganizationId":"\#(org)"}"#),
            ok(#"{"success":true,"data":{"userBudget":{"remaining":1240,"total":3000,"used":1760,"resetsAt":"2026-10-31T23:59:59.000Z","allowance":3000,"metering":"metered"},"orgPool":{"remaining":4500,"referralRemaining":0,"purchasedRemaining":0,"referralDebt":0}}}"#),
            ok(#"{"success":true,"data":{"currentSessionId":"ses_1","sessions":[{"id":"ses_1","userAgent":"teler-ios/0.1.0","ipAddress":"203.0.113.9","createdAt":"2026-10-11T08:00:00.000Z","updatedAt":"2026-10-11T09:00:00.000Z","cliOrganizationIds":null},{"id":"ses_2","userAgent":"teler-cli/0.4.0","createdAt":"2026-10-01T08:00:00.000Z","updatedAt":"2026-10-10T09:00:00.000Z","cliOrganizationIds":["\#(org)"]}]}}"#),
        ])
        let settings = SettingsModel(workspace: Workspace(client: .stubbed(transport)))
        await settings.load()
        #expect(settings.problem == nil)
        #expect(settings.membership?.name == "Roure Coffee" && settings.membership?.role == "owner")
        #expect(settings.organizations.count == 2)
        #expect(settings.credits?.userBudget?.remaining == 1240)
        #expect(settings.credits?.orgPool?.remaining == 4500)
        #expect(settings.devices?.currentSessionId == "ses_1")
        #expect(settings.devices?.sessions.map(\.isCommandLine) == [false, true])
        #expect(transport.requests.map(\.url.path) == [
            "/api/user/organizations", "/api/teler-cli/me", "/api/credits/\(org)", "/api/user/sessions",
        ])
    }

    @Test func switchesTheActiveOrganizationLikeTheWeb() async throws {
        let transport = StubTransport([
            ok(#"{"activeOrganizationId":"\#(org)"}"#),
            ok(#"{"success":true,"data":{"organizationId":"\#(other)"}}"#),
        ])
        let workspace = Workspace(client: .stubbed(transport))
        _ = try await workspace.activeOrganization()
        let settings = SettingsModel(workspace: workspace)
        let target = try #require(OrganizationID(rawValue: other))
        #expect(await settings.switchOrganization(to: target))
        let request = try #require(transport.requests.last)
        #expect(request.method == .put && request.url.path == "/api/user/active-organization")
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(request.body))
        #expect(body["organizationId"] == .string(other))
    }

    @Test func refusesToSignOutAnythingButASessionID() async {
        let transport = StubTransport([])
        await #expect(throws: TelerAPIError.invalidResponse) {
            try await TelerAPIClient.stubbed(transport).signOutDevice("../user")
        }
        #expect(transport.requests.isEmpty)
    }

    @Test func namesDevicesFromTheirUserAgent() {
        let safari =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        let chrome =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
        let mac = DeviceDescription(userAgent: safari, isCommandLine: false)
        #expect(mac.app == .browser("Safari") && mac.platform == .mac)
        let windows = DeviceDescription(userAgent: chrome, isCommandLine: false)
        #expect(windows.app == .browser("Chrome") && windows.platform == .windows)
        #expect(DeviceDescription(userAgent: "teler-ios/0.1.0", isCommandLine: false).app == .iPhoneApp)
        #expect(DeviceDescription(userAgent: nil, isCommandLine: true).app == .commandLine)
    }
}
