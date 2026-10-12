import Foundation
import TelerKit

/// The demo's Needs you: an Agent alert, an Agent flag, an access request and
/// an alert that closed on its own, in the server's wire format.
enum DemoNeedsYou {
    static let reorderAlert = "alrt_demo_reorder"
    static let refundRun = "arun_demo_refunds"
    static let accessRequest = "areq_demo_wholesale"

    static func findings(now: Date = Date(), seen: Set<String>) -> JSONValue {
        func ago(_ hours: Double) -> JSONValue { .string(DemoData.timestamp(now.addingTimeInterval(-hours * 3600))) }
        var flags: [JSONValue] = []
        flags.append(
            .object([
                "source": .string("agent_alert"), "alertId": .string(reorderAlert), "agentId": .string("agt_demo_reorder"),
                "agentLabel": .string("Wholesale reorder watch"), "isOwner": .bool(true), "ownerName": .null,
                "alsoAlerted": .array([]), "state": .string("open"),
                "title": .string("3 cafés are late on their usual reorder"),
                "rule": .string("Flag a wholesale customer that hasn't reordered within 1.5× its usual interval."),
                "findings": .number(3),
                "items": .array([
                    .string("Café Montjuïc · usually every 14 days · last order 23 days ago"),
                    .string("Forn Sant Pau · usually every 14 days · last order 21 days ago"),
                    .string("La Tostadora, València · usually every 10 days · last order 19 days ago"),
                ]),
                "metric": .object([
                    "value": .number(4860), "format": .string("number"), "label": .string("Monthly revenue at risk (€)"),
                ]),
                "threshold": .null, "series": .null, "repeatCount": .number(0), "lastRunId": .string("arun_demo_reorder"),
                "openedAt": ago(2), "lastFlaggedAt": ago(2), "resolvedAt": .null, "leavesAt": .null,
                "seen": .bool(seen.contains(reorderAlert)),
            ]))
        if !seen.contains(refundRun) {
            flags.append(
                .object([
                    "source": .string("agent_run_flag"), "runId": .string(refundRun), "agentId": .string("agt_demo_refunds"),
                    "agentLabel": .string("Daily refunds check"), "kind": .string("finding"), "status": .string("open"),
                    "title": .string("Refunds at the Lisbon store are above 5%"),
                    "rule": .string("Flag any store whose refund rate passes 5% of the day's orders."),
                    "findings": .number(1), "items": .array([.string("Lisbon · 6.2% of 412 orders refunded")]),
                    "metric": .object(["value": .number(6.2), "format": .string("percent"), "label": .string("Refund rate")]),
                    "threshold": .number(5), "series": .null, "createdAt": ago(5), "seenAt": .null,
                ]))
        }
        flags.append(
            .object([
                "source": .string("agent_alert"), "alertId": .string("alrt_demo_stock"), "agentId": .string("agt_demo_stock"),
                "agentLabel": .string("Stockout watch"), "isOwner": .bool(true), "ownerName": .null, "alsoAlerted": .array([]),
                "state": .string("resolved"), "title": .string("Ethiopia Guji is out of stock in 2 stores"),
                "rule": .null, "findings": .number(2), "items": .null, "metric": .null, "threshold": .null, "series": .null,
                "repeatCount": .number(1), "lastRunId": .null, "openedAt": ago(30), "lastFlaggedAt": ago(26),
                "resolvedAt": ago(3), "leavesAt": .string(DemoData.timestamp(now.addingTimeInterval(21 * 3600))),
                "seen": .bool(true),
            ]))
        return .object(["flags": .array(flags)])
    }

    static func accessActivity(now: Date = Date(), decided: Bool) -> JSONValue {
        let person = { (id: String, name: String) -> JSONValue in
            .object(["userId": .string(id), "membershipId": .null, "name": .string(name)])
        }
        let request: JSONValue = .object([
            "id": .string(accessRequest), "organizationId": .string(DemoData.organization.rawValue),
            "projectId": .string("prj_demo_general"),
            "group": .object([
                "kind": .string("connector"), "id": .string("conn_demo_wholesale"), "owner": person("usr_demo_laia", "Laia Puig"),
                "connectionName": .string("Wholesale orders"), "restrictedCount": .number(2),
                "approvers": .array([person("usr_demo_laia", "Laia Puig")]),
            ]),
            "requester": person("usr_demo_pere", "Pere Vidal"),
            "origin": .object(["kind": .string("chat"), "id": .null, "messageId": .null]),
            "reason": .string("To see which cafés are late on their reorders"), "originalQuestion": .null,
            "status": .string("pending"), "createdAt": .string(DemoData.timestamp(now.addingTimeInterval(-75 * 60))),
            "decidedAt": .null, "decidedBy": .null, "declineReason": .null, "grantedCount": .number(0),
        ])
        return .object(["pending": .array(decided ? [] : [request]), "latestDecision": .null, "answered": .array([])])
    }

    static let reviewItems: JSONValue = .object([
        "items": .array([
            .object([
                "id": .string("tbl_demo_orders"), "kind": .string("table"), "name": .string("wholesale_orders"),
                "rowCount": .number(18240),
            ]),
            .object([
                "id": .string("tbl_demo_customers"), "kind": .string("table"), "name": .string("wholesale_customers"),
                "rowCount": .number(312),
            ]),
        ]),
        "selectedItemIds": .array([]), "evidence": .string("unverified"),
    ])
}
