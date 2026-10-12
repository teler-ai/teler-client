import Foundation
import Testing

@testable import TelerFeatures
@testable import TelerKit

/// Deleting an account: blockers, proving it's you, and the background finish.
@MainActor @Suite struct AccountDeletionTests {
    private let preflight = #"""
        {"success":true,"data":{"identity":{"method":"password","totpRequired":true},"canDelete":true,"blockers":[],
         "checkedAt":"2026-10-12T08:00:00.000Z","expiresAt":"2026-10-12T08:05:00.000Z",
         "consequences":{"sharedOrganizationsLeaving":1,"personalOrganizationsDeleting":1}}}
        """#

    @Test func showsWhatBlocksDeletion() async throws {
        let transport = StubTransport([
            .response(
                status: 200,
                chunks: [
                    #"{"success":true,"data":{"identity":{"method":"email","totpRequired":false},"canDelete":false,"blockers":[{"code":"shared_organization_owner","organizationId":"org_1"}],"organizations":[{"id":"org_1","name":"Roure Coffee","slug":"roure","currentMemberRole":"owner","otherMemberCount":3,"eligibleSuccessorCount":2}],"consequences":{}}}"#
                ])
        ])
        let model = AccountDeletionModel(client: .stubbed(transport))
        await model.check()
        guard case .blocked(let check) = model.phase else {
            Issue.record("Expected blocked, got \(model.phase)")
            return
        }
        #expect(check.blockers.map(\.code) == ["shared_organization_owner"])
        #expect(check.organizations.first?.name == "Roure Coffee")
        #expect(check.proof == .emailCode)
    }

    @Test func provesItsYouThenWaitsForTheEnd() async throws {
        let recovery = "__Secure-teler_account_deletion_recovery_abc=rec.sig; Max-Age=2592000; Path=/api/account; HttpOnly; Secure; SameSite=Strict"
        let transport = StubTransport([
            .response(status: 200, chunks: [preflight]),
            .response(
                status: 200, headers: ["Set-Cookie": recovery],
                chunks: [#"{"success":true,"data":{"prepared":true,"operationId":"adel_1","expiresAt":"2026-11-11T08:00:00.000Z"}}"#]),
            .response(status: 401, chunks: [#"{"success":false,"error":{"code":"REAUTHENTICATION_REQUIRED"}}"#]),
            .response(
                status: 202,
                chunks: [#"{"success":true,"data":{"deleted":false,"status":"processing","operationId":"adel_1"}}"#]),
            .response(status: 200, chunks: [#"{"success":true,"data":{"deleted":false,"status":"processing"}}"#]),
            .response(status: 200, chunks: [#"{"success":true,"data":{"deleted":true,"status":"completed"}}"#]),
        ])
        let jar = CookieJar()
        await jar.update(setCookie: Cookies.session)
        let model = AccountDeletionModel(client: .session(transport, jar: jar))
        model.pollInterval = .zero
        var ended = false
        model.sessionsEnding = { ended = true }

        await model.check()
        await model.prepare()
        guard case .proving(let check) = model.phase else {
            Issue.record("Expected proving, got \(model.phase)")
            return
        }
        #expect(check.needsCode)
        await model.confirm(.password("wrong"), authenticatorCode: "123456")
        #expect(model.proofProblem == .wrong)
        #expect(!ended)
        await model.confirm(.password("right"), authenticatorCode: "123456")
        #expect(ended)
        #expect(model.phase == .deleted)

        let requests = transport.requests
        #expect(requests.map(\.url.path) == [
            "/api/account/preflight", "/api/account/prepare", "/api/account/confirm", "/api/account/confirm",
            "/api/account/completion", "/api/account/completion",
        ])
        let keys = Set(requests.dropFirst().prefix(3).compactMap { $0.headers["Idempotency-Key"] })
        #expect(keys.count == 1)
        #expect(requests[3].headers["Cookie"]?.contains("account_deletion_recovery") == true)
        let body = try JSONDecoder().decode(JSONValue.self, from: try #require(requests[3].body))
        #expect(body["confirmation"]?.stringValue == "DELETE MY ACCOUNT")
        #expect(body["password"]?.stringValue == "right")
        #expect(body["totpCode"]?.stringValue == "123456")
        #expect(body["emailToken"] == nil)
        #expect(await jar.headerValue(for: "/api/chat")?.contains("recovery") == false)
    }

    @Test func sendsCookiesOnlyToTheirPaths() {
        let cookie = StoredCookie(name: "r", value: "1", expires: nil, path: "/api/account")
        #expect(cookie.matches("/api/account"))
        #expect(cookie.matches("/api/account/confirm"))
        #expect(!cookie.matches("/api/accounts"))
        #expect(!cookie.matches("/api/chat"))
        #expect(StoredCookie(name: "s", value: "1", expires: nil).matches("/anything"))
    }
}
