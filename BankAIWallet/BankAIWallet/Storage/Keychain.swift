import Foundation
import Security

/// Thin wrapper over the iOS Keychain (kSecClassGenericPassword). Used for the VC
/// JWT and serialized key material — NEVER UserDefaults, which is not secure storage
/// (Phase 14 invariant: VC stored in Keychain, not UserDefaults).
enum Keychain {
    private static let service = "com.bankai.wallet"

    @discardableResult
    static func set(_ data: Data, for key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    @discardableResult
    static func delete(_ key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        return SecItemDelete(query as CFDictionary) == errSecSuccess
    }

    static func setString(_ s: String, for key: String) { set(Data(s.utf8), for: key) }
    static func getString(_ key: String) -> String? { get(key).flatMap { String(data: $0, encoding: .utf8) } }
}
