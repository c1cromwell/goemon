/**
 * Phase 1 — Token factory (RS256).
 *
 * Mints the two short-lived token types used by the agent-access flow:
 *   - exchange token (RFC 8693 style) for SmartChat operations
 *   - scoped token issued after a verified Verifiable Presentation (90s, single-use intent)
 *
 * These are RS256 (asymmetric) so external parties / the MCP endpoint can verify
 * with the public key (exposed via JWKS) without holding a shared secret. This is
 * distinct from session JWTs (HS256, middleware/auth.ts).
 *
 * The keypair is generated in-memory at boot for the prototype. For production,
 * load a persisted key (see didService key handling) and rotate.
 */

import { generateKeyPair, SignJWT, jwtVerify, exportJWK, type JWK, type KeyLike } from "jose";

const ALG = "RS256";
const KID = "did:web:goemonglobal.com#key-1";

let privateKey: KeyLike | null = null;
let publicKey: KeyLike | null = null;
let publicJwk: JWK | null = null;

export async function initTokenFactory(): Promise<void> {
  if (privateKey && publicKey) return;
  const { privateKey: priv, publicKey: pub } = await generateKeyPair(ALG, {
    modulusLength: 2048,
    extractable: true,
  });
  privateKey = priv;
  publicKey = pub;
  publicJwk = await exportJWK(pub);
}

function requireKeys(): { priv: KeyLike; pub: KeyLike } {
  if (!privateKey || !publicKey) {
    throw new Error("tokenFactory not initialized; call initTokenFactory() at boot");
  }
  return { priv: privateKey, pub: publicKey };
}

export interface ExchangeTokenInput {
  userId: string;
  agentId: string;
  agentName: string;
  agentType: string;
  scope: string[];
  operation: string;
  params: Record<string, unknown>;
  ttlSecs: number;
}

export async function mintExchangeToken(input: ExchangeTokenInput): Promise<string> {
  const { priv } = requireKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    act: { sub: input.agentId, name: input.agentName, type: input.agentType },
    scope: input.scope,
    op: input.operation,
    params: input.params,
  })
    .setProtectedHeader({ alg: ALG, kid: KID, typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + input.ttlSecs)
    .sign(priv);
}

export async function mintScopedToken(
  jti: string,
  walletDid: string,
  clientDid: string,
  scope: string[],
  ttlSecs: number
): Promise<string> {
  const { priv } = requireKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ act: { sub: clientDid }, scope })
    .setProtectedHeader({ alg: ALG, kid: KID, typ: "JWT" })
    .setSubject(walletDid)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSecs)
    .sign(priv);
}

export interface VerifiedToken {
  payload: {
    sub?: string;
    act?: { sub?: string; name?: string; type?: string };
    scope?: string[];
    jti?: string;
    op?: string;
    params?: Record<string, unknown>;
    exp?: number;
    iat?: number;
  };
}

export async function verifyToken(token: string): Promise<VerifiedToken> {
  const { pub } = requireKeys();
  const { payload } = await jwtVerify(token, pub, { algorithms: [ALG] });
  return { payload: payload as VerifiedToken["payload"] };
}

/** JWKS for the MCP endpoint / external verifiers. */
export function getJWKS(): { keys: JWK[] } {
  if (!publicJwk) throw new Error("tokenFactory not initialized");
  return { keys: [{ ...publicJwk, kid: KID, use: "sig", alg: ALG }] };
}
