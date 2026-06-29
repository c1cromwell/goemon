/**
 * did:key encoding for P-256 (ES256) — browser port of the backend's didKey.ts
 * (`publicJwkToDidKey` only; the agent never has to resolve, just mint).
 *
 *   did:key:z<base58btc( varint(0x1200) || compressed-P256-point )>
 *
 * The wallet's VP-signing public key is turned into this DID and bound to the
 * user's VC server-side; the backend resolves it back to verify the signature.
 */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// p256-pub multicodec (0x1200), varint-encoded.
const P256_MULTICODEC = Uint8Array.from([0x80, 0x24]);

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let q = digits.length - 1; q >= 0; q--) out += B58_ALPHABET[digits[q]!];
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a P-256 public JWK (x, y) into a did:key:z… DID. */
export function publicJwkToDidKey(jwk: { kty?: string; crv?: string; x?: string; y?: string }): string {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Expected a P-256 EC public JWK with x and y");
  }
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  const prefix = (y[y.length - 1]! & 1) === 1 ? 0x03 : 0x02;
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(x, 1);

  const full = new Uint8Array(P256_MULTICODEC.length + compressed.length);
  full.set(P256_MULTICODEC, 0);
  full.set(compressed, P256_MULTICODEC.length);
  return `did:key:z${base58Encode(full)}`;
}
