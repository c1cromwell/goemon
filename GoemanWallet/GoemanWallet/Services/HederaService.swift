import Foundation

/// On-chain (Hedera) operations. Requires the user session bearer (the Hedera API
/// routes are authenticated). Non-custodial: the device holds the Hedera key,
/// signs frozen transaction bytes locally (Face ID), and the server builds + submits.
final class HederaService {
    static let shared = HederaService()
    private init() {}

    struct Account: Decodable { let hederaAccountId: String; let network: String; let usdcAssociated: Bool }
    struct Balance: Decodable {
        struct OnChain: Decodable { let hbarTinybars: String; let usdcMicro: String }
        struct Ledger: Decodable { let usdcCash: String }
        let onChain: OnChain
        let ledger: Ledger
    }

    /// Provision the on-chain account keyed to this device's Ed25519 public key.
    func provision(session token: String) async throws -> Account {
        struct Body: Encodable { let publicKey: String }
        let pub = try KeyService.shared.hederaPublicKeyHex()
        return try await APIClient.shared.post("/api/hedera/account", body: Body(publicKey: pub), bearer: token)
    }

    func account(session token: String) async throws -> Account {
        try await APIClient.shared.get("/api/hedera/account", bearer: token)
    }

    func balance(session token: String) async throws -> Balance {
        try await APIClient.shared.get("/api/hedera/balance", bearer: token)
    }

    /// Send USDC: build (server) → sign (device) → submit (server).
    func send(toAccountId: String, amountMicro: String, session token: String) async throws -> String {
        struct BuildBody: Encodable {
            let toHederaAccountId: String
            let amountMicro: String
        }
        struct BuildResp: Decodable {
            let buildId: String
            let transactionBytesBase64: String
        }
        struct SubmitBody: Encodable {
            let buildId: String
            let signatureHex: String
        }
        struct SubmitResp: Decodable {
            let transactionId: String
        }

        let buildKey = UUID().uuidString
        let build: BuildResp = try await APIClient.shared.post(
            "/api/hedera/transfer/build",
            body: BuildBody(toHederaAccountId: toAccountId, amountMicro: amountMicro),
            bearer: token,
            idempotencyKey: buildKey
        )

        guard let frozen = Data(base64Encoded: build.transactionBytesBase64) else {
            throw WalletError.decode("Invalid transaction bytes from server")
        }

        let signature = try KeyService.shared.signHederaTransaction(frozen)
        let submit: SubmitResp = try await APIClient.shared.post(
            "/api/hedera/transfer/submit",
            body: SubmitBody(
                buildId: build.buildId,
                signatureHex: signature.map { String(format: "%02x", $0) }.joined()
            ),
            bearer: token
        )
        return submit.transactionId
    }
}
