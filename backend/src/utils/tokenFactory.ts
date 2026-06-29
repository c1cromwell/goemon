/**
 * Phase 1 — Token factory (RS256), updated in Phase 2 for key persistence.
 *
 * Mints the two short-lived token types used by the agent-access flow:
 *   - exchange token (RFC 8693 style) for SmartChat operations
 *   - scoped token issued after a verified Verifiable Presentation (90s, single-use intent)
 *
 * These are RS256 (asymmetric) so external parties / the MCP endpoint can verify
 * with the public key (exposed via JWKS) without holding a shared secret. This is
 * distinct from session JWTs (HS256, middleware/auth.ts).
 *
 * Phase 2: keypair is persisted in did_keys via didService (survives restarts).
 * Phase 2: verifyToken uses all active keys so rotation doesn't break in-flight tokens.
 */

import { SignJWT, jwtVerify, createLocalJWKSet, type JWK } from "jose";
import { initDid, getActiveKey, getAllActiveJwks } from "../services/didService";

const ALG = "RS256";

export async function initTokenFactory(): Promise<void> {
  await initDid();
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
  const { kid, privateKey } = getActiveKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    act: { sub: input.agentId, name: input.agentName, type: input.agentType },
    scope: input.scope,
    op: input.operation,
    params: input.params,
  })
    .setProtectedHeader({ alg: ALG, kid, typ: "JWT" })
    .setSubject(input.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + input.ttlSecs)
    .sign(privateKey);
}

export async function mintScopedToken(
  jti: string,
  walletDid: string,
  clientDid: string,
  scope: string[],
  ttlSecs: number
): Promise<string> {
  const { kid, privateKey } = getActiveKey();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ act: { sub: clientDid }, scope })
    .setProtectedHeader({ alg: ALG, kid, typ: "JWT" })
    .setSubject(walletDid)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSecs)
    .sign(privateKey);
}

/**
 * Sign an arbitrary claim set with the issuer key (RS256) — a tamper-evident,
 * JWKS-verifiable attestation. Used by the self-custody attestation/export so a
 * user (or anyone) can verify Goemon's statement against /.well-known/jwks.json.
 */
export async function signIssuerJwt(claims: Record<string, unknown>, opts?: { subject?: string; ttlSecs?: number; type?: string }): Promise<string> {
  const { kid, privateKey } = getActiveKey();
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: ALG, kid, typ: opts?.type ?? "JWT" }).setIssuedAt(now);
  if (opts?.subject) jwt = jwt.setSubject(opts.subject);
  if (opts?.ttlSecs) jwt = jwt.setExpirationTime(now + opts.ttlSecs);
  return jwt.sign(privateKey);
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

/** Verifies against all active keys (supports rotation — old tokens stay valid). */
export async function verifyToken(token: string): Promise<VerifiedToken> {
  const jwks = createLocalJWKSet(getAllActiveJwks());
  const { payload } = await jwtVerify(token, jwks, { algorithms: [ALG] });
  return { payload: payload as VerifiedToken["payload"] };
}

/** JWKS for the MCP endpoint / external verifiers. Returns all active keys. */
export function getJWKS(): { keys: (JWK & { kid: string; use: string; alg: string })[] } {
  return getAllActiveJwks();
}
