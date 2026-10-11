import Foundation
import Observation
import TelerKit

/// The account's settings: organizations, credits and signed-in devices.
@MainActor @Observable
public final class SettingsModel {
    private let workspace: Workspace
    public private(set) var organizations: [OrganizationMembership] = []
    public private(set) var activeOrganization: OrganizationID?
    public private(set) var credits: Credits?
    public private(set) var devices: SignedInDevices?
    public private(set) var isSwitching = false
    public var problem: Problem?

    public init(workspace: Workspace) {
        self.workspace = workspace
    }

    /// The member's place in the active organization.
    public var membership: OrganizationMembership? {
        organizations.first { $0.id == activeOrganization?.rawValue }
    }

    /// Reads what each section shows. A section that can't load stays empty
    /// rather than interrupting; only actions report problems.
    public func load() async {
        let client = workspace.client
        async let organizations = try? client.organizations()
        async let active = try? workspace.activeOrganization()
        self.organizations = await organizations ?? self.organizations
        activeOrganization = await active ?? activeOrganization
        if let activeOrganization, membership?.creditMetering != "legacy_private_chat_bypass" {
            credits = try? await client.credits(for: activeOrganization)
        }
        devices = try? await client.signedInDevices()
    }

    /// Switches the active organization. True when it changed, after which
    /// the app reloads everything for the new organization.
    public func switchOrganization(to organization: OrganizationID) async -> Bool {
        guard organization != activeOrganization, !isSwitching else { return false }
        isSwitching = true
        defer { isSwitching = false }
        do {
            try await workspace.client.setActiveOrganization(organization)
            activeOrganization = organization
            return true
        } catch {
            problem = Problem(error)
            return false
        }
    }

    public func signOut(device: String) async {
        do {
            try await workspace.client.signOutDevice(device)
            devices = try? await workspace.client.signedInDevices()
        } catch {
            problem = Problem(error)
        }
    }

    public func signOutOtherDevices() async {
        do {
            try await workspace.client.signOutOtherDevices()
            devices = try? await workspace.client.signedInDevices()
        } catch {
            problem = Problem(error)
        }
    }
}

/// What a signed-in device is, read from its user agent.
public struct DeviceDescription: Sendable, Equatable {
    public enum App: Sendable, Equatable {
        case iPhoneApp
        case desktopApp
        case commandLine
        case browser(String?)
    }

    public enum Platform: Sendable, Equatable {
        case iPhone, iPad, mac, windows, linux, android, unknown
    }

    public let app: App
    public let platform: Platform

    public init(userAgent: String?, isCommandLine: Bool) {
        let agent = userAgent ?? ""
        platform =
            if agent.contains("iPhone") || agent.hasPrefix("teler-ios/") { .iPhone }
            else if agent.contains("iPad") { .iPad }
            else if agent.contains("Macintosh") || agent.contains("Mac OS X") || agent.contains("darwin") { .mac }
            else if agent.contains("Windows") || agent.contains("win32") { .windows }
            else if agent.contains("Android") { .android }
            else if agent.contains("Linux") || agent.contains("linux") { .linux }
            else { .unknown }
        app =
            if agent.hasPrefix("teler-ios/") { .iPhoneApp }
            else if agent.contains("TelerDesktop/") { .desktopApp }
            else if isCommandLine || agent.hasPrefix("teler-cli/") { .commandLine }
            else if agent.contains("Edg/") { .browser("Edge") }
            else if agent.contains("OPR/") { .browser("Opera") }
            else if agent.contains("Firefox/") { .browser("Firefox") }
            else if agent.contains("Chrome/") || agent.contains("CriOS/") { .browser("Chrome") }
            else if agent.contains("Safari/") { .browser("Safari") }
            else { .browser(nil) }
    }
}
