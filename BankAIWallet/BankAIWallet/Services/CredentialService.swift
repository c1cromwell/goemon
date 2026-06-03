import Foundation

/// Holds the user's Verifiable Credential (VC JWT) in the Keychain — NOT
/// UserDefaults (Phase 14 invariant o). Also performs holder binding: registering
/// the wallet's did:key against the user's VC so the backend will accept this
/// wallet's presentations.
final class CredentialService: ObservableObject {
    static let shared = CredentialService()
    private let vcKey = "vc_jwt"

    @Published var credentialJWT: String?

    private init() {
        credentialJWT = Keychain.getString(vcKey)
    }

    var hasCredential: Bool { credentialJWT != nil }

    func store(_ jwt: String) {
        Keychain.setString(jwt, for: vcKey)
        DispatchQueue.main.async { self.credentialJWT = jwt }
    }

    func clear() {
        Keychain.delete(vcKey)
        DispatchQueue.main.async { self.credentialJWT = nil }
    }

    /// Decode (without verifying) the VC payload for display — claims like tier/ops.
    func decodedClaims() -> [String: Any]? {
        guard let jwt = credentialJWT else { return nil }
        let parts = jwt.split(separator: ".")
        guard parts.count == 3, let data = Base64URL.decode(String(parts[1])) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // MARK: - Setup-time operations (use a user session bearer token)

    /// Issue a VC for the authenticated user (idempotent server-side) and store it.
    func issueCredential(session token: String) async throws {
        struct Resp: Decodable { let jwt: String }
        let r: Resp = try await APIClient.shared.post("/api/credentials/issue", body: EmptyBody(), bearer: token)
        store(r.jwt)
    }

    /// Bind this wallet's did:key to the user's VC (holder binding).
    func bindWallet(session token: String) async throws {
        let did = try KeyService.shared.walletDID()
        struct Body: Encodable { let walletDid: String }
        struct Resp: Decodable { let bound: Bool }
        let _: Resp = try await APIClient.shared.post("/api/credentials/bind-wallet", body: Body(walletDid: did), bearer: token)
    }
}

struct EmptyBody: Encodable {}
