import Foundation

/// Holds the user's BankAI session token, used ONLY for setup-time authenticated
/// calls (issue VC, bind wallet, provision/transfer on Hedera). Day-to-day agent
/// access does not use this — it goes through OID4VP. Dev uses password login;
/// production would use passkeys (WebAuthn), out of scope for this wallet build.
@MainActor
final class SessionStore: ObservableObject {
    static let shared = SessionStore()
    private let tokenKey = "user_session_token"

    @Published var token: String?
    @Published var email: String?

    private init() {
        token = Keychain.getString(tokenKey)
        email = Keychain.getString("user_email")
    }

    var isAuthenticated: Bool { token != nil }

    func login(email: String, password: String) async throws {
        struct Body: Encodable { let email: String; let password: String }
        struct Resp: Decodable { let userId: String; let token: String }
        let r: Resp = try await APIClient.shared.post("/api/auth/login/password", body: Body(email: email, password: password))
        Keychain.setString(r.token, for: tokenKey)
        Keychain.setString(email, for: "user_email")
        self.token = r.token
        self.email = email
    }

    func signOut() {
        Keychain.delete(tokenKey)
        Keychain.delete("user_email")
        token = nil
        email = nil
        CredentialService.shared.clear()
        KeyService.shared.wipe()
    }
}
