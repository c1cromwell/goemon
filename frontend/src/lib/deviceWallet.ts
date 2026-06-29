/**
 * Browser device wallet — the web stand-in for the iOS Secure-Enclave wallet.
 *
 * Holds an ES256 (P-256) key in localStorage and signs Verifiable Presentations
 * locally with the native Web Crypto API (no jose dependency). The public key is
 * published as a did:key and bound to the user's VC server-side (holder binding);
 * the backend resolves the DID to verify every VP signature.
 *
 * This is what lets the "Pay with Goeman" button authorize a payment with the
 * user's credential instead of a login/redirect: the wallet signs a VP over a
 * one-time checkout nonce, and the backend's /pay-with-presentation route accepts
 * it with NO session. In the real product this key lives in the Secure Enclave and
 * Face ID gates each signature.
 */

const STORE = "goeman_device_wallet";

// ---- did:key P-256 encoder (port of the backend / goeman-agent didKey.ts) ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P256_MULTICODEC = Uint8Array.from([0x80, 0x24]); // p256-pub multicodec, varint

function base58(bytes: Uint8Array): string {
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
  for (let q = digits.length - 1; q >= 0; q--) out += B58[digits[q]!];
  return out;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonToB64url(obj: unknown): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function publicJwkToDidKey(jwk: { kty?: string; crv?: string; x?: string; y?: string }): string {
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
  return `did:key:z${base58(full)}`;
}

// ---- key store -------------------------------------------------------------
let cached: { priv: CryptoKey; walletDid: string } | null = null;

async function loadOrCreate(): Promise<{ priv: CryptoKey; walletDid: string }> {
  if (cached) return cached;
  const raw = localStorage.getItem(STORE);
  if (raw) {
    const { privateJwk, walletDid } = JSON.parse(raw) as { privateJwk: JsonWebKey; walletDid: string };
    const priv = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    cached = { priv, walletDid };
    return cached;
  }
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const walletDid = publicJwkToDidKey(pubJwk);
  localStorage.setItem(STORE, JSON.stringify({ privateJwk: privJwk, walletDid }));
  const priv = await crypto.subtle.importKey("jwk", privJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  cached = { priv, walletDid };
  return cached;
}

/** The wallet's did:key (creating the key on first call). */
export async function getWalletDid(): Promise<string> {
  return (await loadOrCreate()).walletDid;
}

/**
 * Sign a Verifiable Presentation binding the VC to a one-time nonce + audience.
 * Returns a compact ES256 JWT — Web Crypto's ECDSA signature is already the raw
 * r‖s the JWS ES256 format expects, so no DER conversion is needed.
 */
export async function signPresentation(opts: { nonce: string; vcJwt: string; aud: string }): Promise<string> {
  const { priv, walletDid } = await loadOrCreate();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    iss: walletDid,
    aud: opts.aud,
    nonce: opts.nonce,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: walletDid,
      verifiableCredential: [opts.vcJwt],
    },
  };
  const signingInput = `${jsonToB64url(header)}.${jsonToB64url(payload)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

export function resetWallet(): void {
  localStorage.removeItem(STORE);
  cached = null;
}
