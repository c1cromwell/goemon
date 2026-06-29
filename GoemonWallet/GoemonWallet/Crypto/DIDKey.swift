import Foundation

/// did:key encoding for P-256 (ES256) — the Swift counterpart of the backend's
/// `didKey.ts`. The wallet's Secure-Enclave VP-signing public key is published as
///
///   did:key:z<base58btc( varint(0x1200) || compressed-P256-point )>
///
/// and bound to the user's VC server-side; the backend resolves it to verify every
/// VP signature.
enum DIDKey {
    /// p256-pub multicodec (0x1200), varint-encoded.
    private static let p256Multicodec: [UInt8] = [0x80, 0x24]
    private static let b58Alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    /// Encode a P-256 public key given its uncompressed X9.63 representation
    /// (`0x04 || X(32) || Y(32)`, e.g. from `publicKey.x963Representation`).
    static func fromX963(_ x963: Data) -> String? {
        let bytes = [UInt8](x963)
        guard bytes.count == 65, bytes[0] == 0x04 else { return nil }
        let x = Array(bytes[1..<33])
        let y = Array(bytes[33..<65])
        let prefix: UInt8 = (y.last! & 1) == 1 ? 0x03 : 0x02
        let compressed = [prefix] + x
        let full = p256Multicodec + compressed
        return "did:key:z" + base58Encode(full)
    }

    static func base58Encode(_ bytes: [UInt8]) -> String {
        if bytes.isEmpty { return "" }
        var digits: [Int] = [0]
        for byte in bytes {
            var carry = Int(byte)
            for j in 0..<digits.count {
                carry += digits[j] << 8
                digits[j] = carry % 58
                carry /= 58
            }
            while carry > 0 {
                digits.append(carry % 58)
                carry /= 58
            }
        }
        var out = ""
        for b in bytes { if b == 0 { out += "1" } else { break } }
        for d in digits.reversed() { out.append(b58Alphabet[d]) }
        return out
    }
}
