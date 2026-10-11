#if canImport(Security)
    import Foundation
    import Security

    /// Keeps the session cookies in the Keychain, readable after the first
    /// unlock and never synced or restored to another device.
    public struct KeychainSessionStore: SessionStore {
        private let service = "ai.teler.app.session"
        private let account: String

        /// One session per Teler origin.
        public init(origin: TelerOrigin) {
            account = origin.description
        }

        public func load() -> [StoredCookie] {
            var query = baseQuery
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
                let data = item as? Data
            else { return [] }
            return (try? JSONDecoder().decode([StoredCookie].self, from: data)) ?? []
        }

        public func save(_ cookies: [StoredCookie]) {
            guard let data = try? JSONEncoder().encode(cookies) else { return }
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            if SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
                == errSecItemNotFound
            {
                SecItemAdd(baseQuery.merging(attributes) { $1 } as CFDictionary, nil)
            }
        }

        public func clear() {
            SecItemDelete(baseQuery as CFDictionary)
        }

        private var baseQuery: [String: Any] {
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecAttrSynchronizable as String: false,
            ]
        }
    }
#endif
