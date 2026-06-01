/**
 * Phase 7 — did:key resolution for P-256 (ES256), security-critical.
 *
 * Wallet Verifiable Presentations are signed with a Secure-Enclave P-256 key and
 * identified by a `did:key:z…` DID. To verify a VP signature we must turn that DID
 * back into a public key. This module implements the did:key codec for the
 * `p256-pub` multicodec (0x1200) with NO external dependencies:
 *
 *   did:key:z<base58btc( varint(0x1200) || compressed-P256-point )>
 *
 * `resolveDidKeyToPublicKey` is the function presentationService depends on.
 * `publicJwkToDidKey` is the inverse (used by tests / a future wallet) so we can
 * mint a did:key from a generated keypair.
 *
 * References: W3C did:key, multicodec table, SEC1 point compression.
 */

import { importJWK, type KeyLike, type JWK } from "jose";

// --- base58btc (Bitcoin alphabet) -----------------------------------------

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_MAP[B58_ALPHABET[i]!] = i;

function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = B58_MAP[ch];
    if (value === undefined) throw new Error(`Invalid base58 character: ${ch}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's in base58 are leading zero bytes.
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

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

// --- P-256 curve math (for point (de)compression) -------------------------

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const A = P - 3n; // a = -3 mod p
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
// p ≡ 3 (mod 4) so sqrt(n) = n^((p+1)/4) mod p
const SQRT_EXP = (P + 1n) / 4n;
// p256-pub multicodec, varint-encoded (0x1200 -> 0x80 0x24)
const P256_MULTICODEC = Uint8Array.from([0x80, 0x24]);

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  return n;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Decompress a 33-byte SEC1 compressed P-256 point into (x, y) coordinates. */
function decompressPoint(compressed: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  if (compressed.length !== 33) throw new Error("Compressed P-256 point must be 33 bytes");
  const prefix = compressed[0]!;
  if (prefix !== 0x02 && prefix !== 0x03) throw new Error("Invalid compressed point prefix");
  const x = bytesToBigInt(compressed.subarray(1));
  if (x >= P) throw new Error("Point x out of field range");

  // y^2 = x^3 + a*x + b (mod p)
  const y2 = (modPow(x, 3n, P) + ((A * x) % P) + B) % P;
  let y = modPow(y2, SQRT_EXP, P);
  // Verify it is a real square root (rejects points not on the curve).
  if ((y * y) % P !== y2) throw new Error("Point is not on the P-256 curve");

  const wantOdd = prefix === 0x03;
  const isOdd = (y & 1n) === 1n;
  if (isOdd !== wantOdd) y = P - y;
  return { x: bigIntTo32Bytes(x), y: bigIntTo32Bytes(y) };
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

// --- public API ------------------------------------------------------------

/**
 * Resolve a `did:key:z…` (P-256 / ES256) to a verification public key.
 * Throws on any malformed input — callers MUST map that to VP_INVALID and deny.
 */
export async function resolveDidKeyToPublicKey(did: string): Promise<KeyLike> {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) {
    throw new Error("Not a did:key");
  }
  const multibase = did.slice("did:key:".length); // "z…"
  if (multibase[0] !== "z") throw new Error("did:key must use base58btc (z) multibase");

  const decoded = base58Decode(multibase.slice(1));
  if (decoded.length < 2 || decoded[0] !== P256_MULTICODEC[0] || decoded[1] !== P256_MULTICODEC[1]) {
    throw new Error("did:key is not a P-256 (p256-pub) key");
  }
  const keyBytes = decoded.subarray(2);
  const { x, y } = decompressPoint(keyBytes);

  const jwk: JWK = { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y) };
  return (await importJWK(jwk, "ES256")) as KeyLike;
}

/**
 * Encode a P-256 public JWK (with x and y) into a `did:key:z…` DID.
 * Inverse of resolveDidKeyToPublicKey; used by tests and (later) the wallet.
 */
export function publicJwkToDidKey(jwk: JWK): string {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Expected a P-256 EC public JWK with x and y");
  }
  const x = new Uint8Array(Buffer.from(jwk.x, "base64url"));
  const y = new Uint8Array(Buffer.from(jwk.y, "base64url"));
  const prefix = (y[y.length - 1]! & 1) === 1 ? 0x03 : 0x02;
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(x, 1);

  const full = new Uint8Array(P256_MULTICODEC.length + compressed.length);
  full.set(P256_MULTICODEC, 0);
  full.set(compressed, P256_MULTICODEC.length);
  return `did:key:z${base58Encode(full)}`;
}
