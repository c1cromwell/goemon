import Foundation
import CryptoKit
import LocalAuthentication
import Hiero

/// Holds the wallet's two private keys and performs on-device signing. The server
/// NEVER sees a private key (Phase 14 invariant m).
///
///  1. VP signing key — P-256 / ES256, generated in the **Secure Enclave** where
///     available (the private key never leaves the chip; only an encrypted blob is
///     persisted). Used to sign Verifiable Presentations. A LocalAuthentication
///     (Face ID / Touch ID) prompt gates every signature.
///
///  2. Hedera account key — Ed25519 (CryptoKit Curve25519). NOTE: the Secure
///     Enclave only supports P-256, not Ed25519/secp256k1, so a Hedera-native key
///     cannot live in the Enclave; we keep it as a Keychain-stored software key and
///     document the tradeoff. (Choosing Ed25519 over secp256k1 keeps it native to
///     Hedera and to CryptoKit.)
final class KeyService {
    static let shared = KeyService()

    private let vpKeyTag = "vp_signing_key_v1"      // Secure Enclave blob or software raw
    private let vpFallbackFlag = "vp_signing_is_software"
    private let hederaKeyTag = "hedera_hiero_private_key_v1"
    private let hederaLegacyKeyTag = "hedera_ed25519_key_v1"

    private init() {}

    // MARK: - VP signing key (Secure Enclave)

    /// The wallet's did:key (creating the VP key on first use).
    func walletDID() throws -> String {
        let x963 = try vpPublicKeyX963()
        guard let did = DIDKey.fromX963(x963) else { throw WalletError.crypto("Could not derive did:key") }
        return did
    }

    func vpPublicKeyX963() throws -> Data {
        if SecureEnclave.isAvailable, Keychain.getString(vpFallbackFlag) == nil {
            return try secureEnclaveKey(context: nil).publicKey.x963Representation
        }
        return try softwareVPKey().publicKey.x963Representation
    }

    /// Sign arbitrary bytes (the JWS signing input) with the VP key, prompting Face ID.
    /// Returns a JOSE-style raw 64-byte (R‖S) signature.
    func signVP(_ data: Data, reason: String) throws -> Data {
        if SecureEnclave.isAvailable, Keychain.getString(vpFallbackFlag) == nil {
            let ctx = LAContext()
            ctx.localizedReason = reason
            let key = try secureEnclaveKey(context: ctx)
            return try key.signature(for: data).rawRepresentation
        }
        return try softwareVPKey().signature(for: data).rawRepresentation
    }

    private func secureEnclaveKey(context: LAContext?) throws -> SecureEnclave.P256.Signing.PrivateKey {
        if let blob = Keychain.get(vpKeyTag) {
            return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: context)
        }
        var err: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &err
        ) else {
            throw WalletError.crypto("Access control failed: \(String(describing: err))")
        }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access, authenticationContext: context)
        Keychain.set(key.dataRepresentation, for: vpKeyTag) // encrypted blob, safe to persist
        return key
    }

    /// Simulator / no-Enclave fallback (clearly flagged).
    private func softwareVPKey() throws -> P256.Signing.PrivateKey {
        Keychain.setString("1", for: vpFallbackFlag)
        if let raw = Keychain.get(vpKeyTag) {
            return try P256.Signing.PrivateKey(rawRepresentation: raw)
        }
        let key = P256.Signing.PrivateKey()
        Keychain.set(key.rawRepresentation, for: vpKeyTag)
        return key
    }

    var isUsingSoftwareFallback: Bool { !SecureEnclave.isAvailable || Keychain.getString(vpFallbackFlag) != nil }

    // MARK: - Hedera key (Ed25519 via Hiero SDK)

    private func hederaPrivateKey() throws -> PrivateKey {
        if let stored = Keychain.getString(hederaKeyTag), let key = PrivateKey(stored) {
            return key
        }
        // Drop legacy CryptoKit-only material — Hiero signing requires a Hiero PrivateKey.
        Keychain.delete(hederaLegacyKeyTag)
        let key = PrivateKey.generateEd25519()
        Keychain.setString(key.toString(), for: hederaKeyTag)
        return key
    }

    /// Raw Ed25519 public key hex (64 chars) for POST /api/hedera/account.
    func hederaPublicKeyHex() throws -> String {
        try hederaPrivateKey().publicKey.toStringRaw()
    }

    /// Sign a frozen Hedera transaction (from /transfer/build) for /transfer/submit.
    func signHederaTransaction(_ frozenBytes: Data) throws -> Data {
        let tx = try Transaction.fromBytes(frozenBytes)
        return Data(try hederaPrivateKey().signTransaction(tx))
    }

    // MARK: - Reset (sign out)

    func wipe() {
        Keychain.delete(vpKeyTag)
        Keychain.delete(vpFallbackFlag)
        Keychain.delete(hederaKeyTag)
        Keychain.delete(hederaLegacyKeyTag)
    }
}

enum WalletError: LocalizedError {
    case crypto(String)
    case api(String)
    case decode(String)

    var errorDescription: String? {
        switch self {
        case .crypto(let m): return m
        case .api(let m): return m
        case .decode(let m): return m
        }
    }
}
