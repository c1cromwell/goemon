import Foundation

/// On-chain (Hedera) operations. Requires the user session bearer (the Hedera API
/// routes are authenticated). The target design is non-custodial: the device holds
/// the Hedera key and signs transaction bytes locally (Face ID), and the server only
/// builds + submits.
///
/// BACKEND GAP: the current backend exposes `GET /api/hedera/account`,
/// `POST /api/hedera/account`, `GET /api/hedera/balance`, and a *server-signed*
/// `POST /api/hedera/transfer`. The on-device split (`/transfer/build` →
/// sign → `/transfer/submit`) below is the Phase-10 target and needs those two
/// endpoints added server-side; until then `send` falls back to the server-signed
/// transfer. This file documents the intended non-custodial flow.
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

    /// Provision the on-chain account, sending the device public key (target design).
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

    /// Send USDC. Target: build (server) → sign (device, Face ID) → submit (server).
    /// Until those endpoints exist, this uses the server-signed transfer path.
    func send(toAccountId: String, amountMicro: String, session token: String) async throws -> String {
        // --- Target non-custodial flow (endpoints pending) -------------------
        // struct BuildResp: Decodable { let txBytesBase64: String; let buildId: String }
        // let build: BuildResp = try await APIClient.shared.post("/api/hedera/transfer/build",
        //     body: ["toAccountId": toAccountId, "amountMicro": amountMicro], bearer: token)
        // let txBytes = Data(base64Encoded: build.txBytesBase64)!
        // let sig = try KeyService.shared.signHedera(txBytes)   // Face ID gated
        // struct SubmitResp: Decodable { let txId: String }
        // let submit: SubmitResp = try await APIClient.shared.post("/api/hedera/transfer/submit",
        //     body: ["buildId": build.buildId, "signatureHex": sig.hex], bearer: token)
        // return submit.txId

        // --- Current backend fallback (server-signed) ------------------------
        struct Body: Encodable { let toHederaAccountId: String; let amountMicro: String }
        struct Resp: Decodable { let txId: String }
        let r: Resp = try await APIClient.shared.post(
            "/api/hedera/transfer",
            body: Body(toHederaAccountId: toAccountId, amountMicro: amountMicro),
            bearer: token,
            idempotencyKey: UUID().uuidString
        )
        return r.txId
    }
}
