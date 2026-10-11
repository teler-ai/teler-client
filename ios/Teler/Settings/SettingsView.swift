import SwiftUI
import TelerFeatures
import TelerKit

/// How the app looks, whatever the iPhone's setting.
enum Appearance: String, CaseIterable {
    case system, light, dark

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// The account's settings, from the avatar on any top-level screen.
struct SettingsView: View {
    let app: AppModel
    @State private var model: SettingsModel
    @State private var showsOrganizations = false
    @State private var confirmsSignOut = false
    @AppStorage("appearance") private var appearance = Appearance.system
    @Environment(\.dismiss) private var dismiss

    init(app: AppModel, workspace: Workspace) {
        self.app = app
        _model = State(initialValue: SettingsModel(workspace: workspace))
    }

    var body: some View {
        NavigationStack {
            List {
                if app.isDemo {
                    sample
                } else {
                    account
                    planAndCredits
                }
                Section("Appearance") {
                    Picker("Appearance", selection: $appearance) {
                        Text("System").tag(Appearance.system)
                        Text("Light").tag(Appearance.light)
                        Text("Dark").tag(Appearance.dark)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                if !app.isDemo {
                    Section("Sign-in and security") {
                        NavigationLink {
                            DevicesView(model: model)
                        } label: {
                            LabeledContent {
                                if let count = model.devices?.sessions.count { Text(count, format: .number) }
                            } label: {
                                Label("Signed-in devices", systemImage: "laptopcomputer.and.iphone")
                            }
                        }
                    }
                    Section {
                        Button("Sign out", role: .destructive) { confirmsSignOut = true }
                            .foregroundStyle(Palette.destructiveInk)
                    }
                }
                about
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Palette.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
            .sheet(isPresented: $showsOrganizations) {
                OrganizationPicker(model: model) {
                    showsOrganizations = false
                    dismiss()
                    app.reloadForNewOrganization()
                }
            }
            .alert("Sign out of Teler on this iPhone?", isPresented: $confirmsSignOut) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await app.session.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your chats and dashboards stay in your account.")
            }
            .alert(
                "Something went wrong",
                isPresented: Binding(get: { model.problem != nil }, set: { if !$0 { model.problem = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(model.problem?.message ?? "")
            }
            .task { if !app.isDemo { await model.load() } }
        }
    }

    @ViewBuilder private var sample: some View {
        Section {
            Label("You're exploring sample data. Sign in to see your own.", systemImage: "flask")
                .foregroundStyle(Palette.foreground)
            Button("Sign in") {
                dismiss()
                Task { await app.session.signOut() }
            }
            .fontWeight(.semibold)
            .foregroundStyle(Palette.primaryInk)
        }
    }

    @ViewBuilder private var account: some View {
        if case .signedIn(let user?) = app.session.state {
            Section {
                HStack(spacing: 12) {
                    Avatar(initials: Avatar.initials(for: user), size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name ?? user.email ?? "").font(.headline).foregroundStyle(Palette.foreground)
                        if let email = user.email, user.name != nil {
                            Text(email).font(.subheadline).foregroundStyle(Palette.mutedForeground)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        Section {
            Button {
                showsOrganizations = true
            } label: {
                LabeledContent {
                    HStack(spacing: 6) {
                        Text(model.membership?.name ?? "")
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                    }
                    .foregroundStyle(Palette.mutedForeground)
                } label: {
                    Label("Organization", systemImage: "building.2").foregroundStyle(Palette.foreground)
                }
            }
            .disabled(model.organizations.count < 2)
        } footer: {
            if let membership = model.membership {
                Text(Self.roleSentence(membership))
            }
        }
    }

    @ViewBuilder private var planAndCredits: some View {
        if let membership = model.membership {
            Section {
                LabeledContent {
                    Text(Self.planName(membership.plan))
                } label: {
                    Label("Plan", systemImage: "gauge.with.needle")
                }
                if let budget = model.credits?.userBudget, budget.total > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        LabeledContent {
                            Text(budget.remaining, format: .number.precision(.fractionLength(0)))
                                .monospacedDigit()
                        } label: {
                            Label("Credits left this month", systemImage: "sparkles")
                        }
                        ProgressView(value: min(budget.remaining, budget.total), total: budget.total)
                            .tint(Palette.primaryInk)
                        Text(Self.creditsDetail(budget))
                            .font(.footnote)
                            .foregroundStyle(Palette.mutedForeground)
                    }
                }
                if let pool = model.credits?.orgPool, pool.remaining > 0 {
                    LabeledContent {
                        Text(pool.remaining, format: .number.precision(.fractionLength(0))).monospacedDigit()
                    } label: {
                        Label("Shared pool", systemImage: "building.2")
                    }
                }
            } header: {
                Text("Plan and credits")
            } footer: {
                Text("Credits are shared between Teler on the web and on iPhone.")
            }
        }
    }

    private var about: some View {
        Section {
            VStack(spacing: 8) {
                TelerMark().frame(width: 24, height: 21)
                Text("Teler for iPhone \(Self.version)")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                HStack(spacing: 16) {
                    Link("Privacy Policy", destination: Self.legal("privacy"))
                    Link("Terms of Service", destination: Self.legal("terms"))
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.primaryInk)
            }
            .frame(maxWidth: .infinity)
        }
        .listRowBackground(Color.clear)
    }

    static func roleSentence(_ membership: OrganizationMembership) -> String {
        switch membership.role {
        case "owner": String(localized: "You're an owner of \(membership.name).")
        case "admin": String(localized: "You're an admin of \(membership.name).")
        default: String(localized: "You're a member of \(membership.name).")
        }
    }

    static func planName(_ plan: String?) -> String {
        switch plan {
        case "professional": String(localized: "Pro")
        case "enterprise": String(localized: "Enterprise")
        default: String(localized: "Free")
        }
    }

    /// "1,240 of 3,000 · resets 1 November": credits reset at the start of the next month.
    static func creditsDetail(_ budget: Credits.Budget) -> String {
        let amount = String(
            localized:
                "\(budget.remaining.formatted(.number.precision(.fractionLength(0)))) of \(budget.total.formatted(.number.precision(.fractionLength(0))))"
        )
        guard let resets = budget.resetsAt?.addingTimeInterval(1) else { return amount }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: resets)) ?? resets
        let day = start < resets ? calendar.date(byAdding: .month, value: 1, to: start) ?? resets : start
        return amount + " · " + String(localized: "resets \(day.formatted(.dateTime.day().month(.wide)))")
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
    }

    /// The web's legal pages, in the app's language when Teler has it.
    static func legal(_ page: String) -> URL {
        let language = Bundle.main.preferredLocalizations.first.map { String($0.prefix(2)) } ?? "en"
        let supported = ["ca", "de", "en", "es", "fr", "it", "pt"].contains(language) ? language : "en"
        return URL(string: "https://teler.ai/\(supported)/\(page)")!
    }
}
