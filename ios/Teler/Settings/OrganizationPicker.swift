import SwiftUI
import TelerFeatures
import TelerKit

/// The member's organizations; picking one switches everything to it.
struct OrganizationPicker: View {
    let model: SettingsModel
    let switched: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.organizations) { organization in
                        Button {
                            guard let id = organization.organization else { return }
                            Task { if await model.switchOrganization(to: id) { switched() } }
                        } label: {
                            HStack(spacing: 12) {
                                Avatar(initials: Self.initials(organization.name), style: .alternate)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(organization.name).foregroundStyle(Palette.foreground)
                                    Text(Self.role(organization.role))
                                        .font(.subheadline)
                                        .foregroundStyle(Palette.mutedForeground)
                                }
                                Spacer()
                                if organization.id == model.activeOrganization?.rawValue {
                                    Image(systemName: "checkmark")
                                        .fontWeight(.semibold)
                                        .foregroundStyle(Palette.primaryInk)
                                        .accessibilityLabel("Current")
                                } else if model.isSwitching {
                                    ProgressView().controlSize(.small)
                                }
                            }
                        }
                        .disabled(model.isSwitching)
                    }
                } footer: {
                    Text("Switching changes the data, chats and dashboards you see.")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle("Organization")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.height(390), .large])
    }

    static func initials(_ name: String) -> String {
        String(name.split(whereSeparator: \.isWhitespace).prefix(2).compactMap(\.first)).uppercased()
    }

    static func role(_ role: String) -> String {
        switch role {
        case "owner": String(localized: "Owner")
        case "admin": String(localized: "Admin")
        default: String(localized: "Member")
        }
    }
}
