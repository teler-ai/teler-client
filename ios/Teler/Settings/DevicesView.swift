import SwiftUI
import TelerFeatures
import TelerKit

/// Where the account is signed in; swipe to sign one out.
struct DevicesView: View {
    let model: SettingsModel
    @State private var confirmsAll = false

    var body: some View {
        List {
            if let devices = model.devices {
                let current = devices.sessions.filter { $0.id == devices.currentSessionId }
                let others = devices.sessions.filter { $0.id != devices.currentSessionId }
                Section("This device") {
                    ForEach(current) { DeviceRow(device: $0, isCurrent: true) }
                }
                if !others.isEmpty {
                    Section {
                        ForEach(others) { device in
                            DeviceRow(device: device, isCurrent: false)
                                .swipeActions {
                                    Button("Sign out", role: .destructive) {
                                        Task { await model.signOut(device: device.id) }
                                    }
                                }
                        }
                    } header: {
                        Text("Other devices")
                    }
                    Section {
                        Button("Sign out of all other devices", role: .destructive) { confirmsAll = true }
                            .foregroundStyle(Palette.destructiveInk)
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.background)
        .navigationTitle("Signed-in devices")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Sign out of all other devices?", isPresented: $confirmsAll) {
            Button("Sign out", role: .destructive) { Task { await model.signOutOtherDevices() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This iPhone stays signed in.")
        }
    }
}

private struct DeviceRow: View {
    let device: SignedInDevice
    let isCurrent: Bool

    var body: some View {
        let description = DeviceDescription(userAgent: device.userAgent, isCommandLine: device.isCommandLine)
        HStack(spacing: 12) {
            IconTile(systemImage: Self.symbol(description))
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.name(description)).foregroundStyle(Palette.foreground)
                Text(activity)
                    .font(.subheadline)
                    .foregroundStyle(Palette.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var activity: String {
        if isCurrent { return String(localized: "Active now") }
        guard let date = device.updatedAt ?? device.createdAt else { return "" }
        return String(localized: "Active \(date.formatted(.relative(presentation: .named)))")
    }

    static func name(_ device: DeviceDescription) -> String {
        let platform: String? =
            switch device.platform {
            case .iPhone: "iPhone"
            case .iPad: "iPad"
            case .mac: "macOS"
            case .windows: "Windows"
            case .linux: "Linux"
            case .android: "Android"
            case .unknown: nil
            }
        switch device.app {
        case .iPhoneApp: return String(localized: "Teler for iPhone")
        case .commandLine: return String(localized: "Teler CLI")
        case .desktopApp:
            return platform.map { String(localized: "Teler Desktop on \($0)") } ?? String(localized: "Teler Desktop")
        case .browser(let browser):
            let name = browser ?? String(localized: "A browser")
            return platform.map { String(localized: "\(name) on \($0)") } ?? name
        }
    }

    static func symbol(_ device: DeviceDescription) -> String {
        switch (device.app, device.platform) {
        case (.commandLine, _): "terminal"
        case (_, .iPhone), (_, .android): "iphone"
        case (_, .iPad): "ipad"
        case (.desktopApp, _): "desktopcomputer"
        default: "laptopcomputer"
        }
    }
}
