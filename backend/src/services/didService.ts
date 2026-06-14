/**
 * Phase 2 — DID key management.
 *
 * Owns the platform issuer RS256 keypair. Keys are persisted in the did_keys
 * table so they survive restarts (unlike the Phase 1 in-memory generation).
 * Supports rotation: a retired key stays in JWKS for 90 days so in-flight
 * tokens signed with it remain verifiable.
 *
 * DIDs:
 *   - Platform issuer: did:web:argusfinancial.com  (fragment #<kid> per key)
 *   - User subject:    did:web:argusfinancial.com:users:<userId>  (deterministic, no key needed)
 * In Phase 5 both migrate to did:hedera:mainnet:<accountId>.
 */

import { v4 as uuidv4 } from "uuid";
import { generateKeyPair, exportJWK, importJWK, type JWK, type KeyLike } from "jose";
import { getDb } from "../db";
import { getKeyVault, isWrapped } from "./keyVaultService";

const ALG = "RS256";
const ROTATION_WINDOW_DAYS = 90;

export interface ActiveKey {
  kid: string;
  privateKey: KeyLike;
  publicKey: KeyLike;
  publicJwk: JWK;
}

let _activeKey: ActiveKey | null = null;
let _allKeys: ActiveKey[] = []; // current + still-valid rotated keys

export async function initDid(): Promise<void> {
  if (_activeKey) return;
  const db = getDb();
  const now = new Date().toISOString();

  const rows = await db.query<{ kid: string; private_jwk: string; public_jwk: string }>(
    `SELECT kid, private_jwk, public_jwk FROM did_keys
     WHERE active = 1 AND (retired_at IS NULL OR retired_at > ?)
     ORDER BY created_at DESC`,
    [now]
  );

  if (rows.length === 0) {
    const fresh = await _generateAndPersist();
    _activeKey = fresh;
    _allKeys = [fresh];
    return;
  }

  _allKeys = await Promise.all(
    rows.map(async (row) => ({
      kid: row.kid,
      privateKey: (await importJWK(await loadPrivateJwk(row.kid, row.private_jwk), ALG)) as KeyLike,
      publicKey: (await importJWK(JSON.parse(row.public_jwk) as JWK, ALG)) as KeyLike,
      publicJwk: JSON.parse(row.public_jwk) as JWK,
    }))
  );

  _activeKey = _allKeys[0]!;
}

/**
 * Phase 20 — resolve the issuer private JWK from its custody-wrapped form.
 *   - wrapped (gcm.v1.) → unwrap (AAD-bound to the kid).
 *   - legacy raw JSON   → parse once, then lazily re-wrap the column in place.
 */
async function loadPrivateJwk(kid: string, stored: string): Promise<JWK> {
  if (isWrapped(stored)) {
    return JSON.parse(await getKeyVault().unwrap(stored, { aad: kid })) as JWK;
  }
  const jwk = JSON.parse(stored) as JWK;
  const wrapped = await getKeyVault().wrap(stored, { aad: kid });
  await getDb().execute("UPDATE did_keys SET private_jwk = ? WHERE kid = ?", [wrapped, kid]);
  return jwk;
}

/** The key used for signing new tokens / VCs. */
export function getActiveKey(): ActiveKey {
  if (!_activeKey) throw new Error("didService not initialized; call initDid() at boot");
  return _activeKey;
}

/** All non-expired keys — for JWKS endpoint and multi-key verification. */
export function getAllActiveJwks(): { keys: (JWK & { kid: string; use: string; alg: string })[] } {
  return {
    keys: _allKeys.map((k) => ({ ...k.publicJwk, kid: k.kid, use: "sig", alg: ALG })),
  };
}

/** Rotate: generate a new key, retire the old one (keeps verifying for 90 days). */
export async function rotateKey(): Promise<ActiveKey> {
  if (!_activeKey) throw new Error("didService not initialized");
  const db = getDb();
  const retiredAt = new Date(Date.now() + ROTATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await db.execute("UPDATE did_keys SET retired_at = ? WHERE kid = ?", [retiredAt, _activeKey.kid]);

  const fresh = await _generateAndPersist();

  // Reload all active keys so _allKeys stays consistent
  await _reload();
  return fresh;
}

/** Platform issuer DID. Fragment #<kid> is appended by callers when needed. */
export const issuerDid = "did:web:argusfinancial.com";

/** User subject DID — deterministic from userId (Phase 5 migrates to did:hedera). */
export function userDid(userId: string): string {
  return `did:web:argusfinancial.com:users:${userId}`;
}

// ---------------------------------------------------------------------------

async function _generateAndPersist(): Promise<ActiveKey> {
  const db = getDb();
  const { privateKey: priv, publicKey: pub } = await generateKeyPair(ALG, {
    modulusLength: 2048,
    extractable: true,
  });
  const kid = uuidv4();
  const privateJwk = await exportJWK(priv);
  const publicJwk = await exportJWK(pub);
  // Phase 20 — the private JWK is wrapped at rest (never stored as plaintext).
  const privateJwkEnc = await getKeyVault().wrap(JSON.stringify(privateJwk), { aad: kid });

  await db.execute(
    `INSERT INTO did_keys (kid, algorithm, private_jwk, public_jwk, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [kid, ALG, privateJwkEnc, JSON.stringify(publicJwk), new Date().toISOString()]
  );

  return { kid, privateKey: priv, publicKey: pub, publicJwk };
}

async function _reload(): Promise<void> {
  _activeKey = null;
  _allKeys = [];
  await initDid();
}
