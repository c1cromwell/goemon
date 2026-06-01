/**
 * Phase 7 — Verifiable Presentation verification (SECURITY-CRITICAL).
 *
 * This is the gate that lets an external AI agent obtain a short-lived, scoped
 * token to act on a user's behalf. The cardinal rule (CLAUDE.md / CONVENTIONS):
 *
 *   A Verifiable Presentation's signature MUST be verified against the wallet
 *   did:key before ANY access is granted. No exceptions.
 *
 * The full check order, after the signature passes:
 *   1. Replay prevention — the same VP (by hash) is never honored twice.
 *   2. Single-use nonce — consumed atomically; a reused/expired nonce is denied.
 *   3. Credential — VC signature verified, not revoked, and holder-bound to the
 *      presenting wallet (vp.iss === credential.wallet_did).
 *   4. Client active — the registered MCP client must not be suspended.
 *   5. Grant present — the user must have an active grant for this agent (no bypass).
 *   6. Effective scope = VC ∩ client ∩ requested ∩ grant. Empty ⇒ denied.
 * Only then is a 90s scoped token minted and the presentation recorded + audited.
 */

import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { decodeJwt, decodeProtectedHeader, jwtVerify, createLocalJWKSet } from "jose";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { resolveDidKeyToPublicKey } from "../utils/didKey";
import { mintScopedToken, getJWKS } from "../utils/tokenFactory";
import { getCredentialBySubject } from "./vcService";
import { getClient } from "./mcpClientRegistry";
import { getActiveGrant, touchGrant } from "./userAgentGrantService";
import { logAudit } from "./auditService";

const SCOPED_TOKEN_TTL_SECS = 90;
const DEFAULT_NONCE_TTL_SECS = 300;

export interface PresentationChallenge {
  nonce: string;
  aud: string;
  scope: string[];
  expiresAt: string;
}

/**
 * Issue a single-use challenge for a client to present against. The requested
 * scope is bound to the nonce here so the agent cannot widen scope at present time.
 */
export async function issueNonce(
  clientDid: string,
  scope: string[],
  ttlSecs = DEFAULT_NONCE_TTL_SECS
): Promise<PresentationChallenge> {
  if (!clientDid) throw new AppError(ErrorCode.VALIDATION, "clientDid required");
  const nonce = uuidv4().replace(/-/g, "") + uuidv4().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + ttlSecs * 1000).toISOString();
  await getDb().execute(
    "INSERT INTO presentation_nonces (nonce, client_did, scope, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    [nonce, clientDid, JSON.stringify(scope), expiresAt, new Date().toISOString()]
  );
  return { nonce, aud: config.BASE_URL, scope, expiresAt };
}

export interface VerifyPresentationInput {
  vpJwt: string;
  ipAddress?: string;
}

export interface ScopedTokenResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string[];
  jti: string;
  userId: string;
  clientDid: string;
}

interface VpPayload {
  iss?: string;
  aud?: string | string[];
  nonce?: string;
  vp?: {
    verifiableCredential?: string[];
    holder?: string;
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function intersect(...sets: string[][]): string[] {
  if (sets.length === 0) return [];
  const [first, ...rest] = sets;
  return first!.filter((s) => rest.every((set) => set.includes(s)));
}

/**
 * Verify a Verifiable Presentation and, if every check passes, mint a 90s scoped
 * token. Throws AppError with a stable code on any failure — the caller never
 * grants access on a thrown path.
 */
export async function verifyPresentation(input: VerifyPresentationInput): Promise<ScopedTokenResult> {
  const { vpJwt } = input;
  const ipAddress = input.ipAddress ?? "";

  // --- 0. Signature verification FIRST (the cardinal rule) ----------------
  let header: { alg?: string };
  let unverified: VpPayload;
  try {
    header = decodeProtectedHeader(vpJwt) as { alg?: string };
    unverified = decodeJwt(vpJwt) as VpPayload;
  } catch {
    throw new AppError(ErrorCode.VP_INVALID, "Malformed presentation");
  }
  if (header.alg !== "ES256") {
    throw new AppError(ErrorCode.VP_INVALID, "Presentation must be signed with ES256");
  }
  const walletDid = unverified.iss;
  if (!walletDid || !walletDid.startsWith("did:key:")) {
    throw new AppError(ErrorCode.VP_INVALID, "Presentation issuer must be a did:key");
  }

  let publicKey;
  try {
    publicKey = await resolveDidKeyToPublicKey(walletDid);
  } catch {
    throw new AppError(ErrorCode.VP_INVALID, "Unresolvable wallet did:key");
  }

  let payload: VpPayload;
  try {
    const verified = await jwtVerify(vpJwt, publicKey, {
      algorithms: ["ES256"],
      audience: config.BASE_URL, // aud check folded into verification
    });
    payload = verified.payload as VpPayload;
  } catch {
    // Covers a wrong signing key, a tampered VP, an expired VP, and aud mismatch.
    throw new AppError(ErrorCode.VP_INVALID, "Presentation signature/audience invalid");
  }

  const nonce = payload.nonce;
  const vcJwt = payload.vp?.verifiableCredential?.[0];
  if (!nonce) throw new AppError(ErrorCode.NONCE_INVALID, "Presentation missing nonce");
  if (!vcJwt) throw new AppError(ErrorCode.VP_INVALID, "Presentation carries no credential");

  // --- 1. Replay prevention (by VP hash) ----------------------------------
  const vpHash = sha256Hex(vpJwt);
  const db = getDb();
  const seen = await db.queryOne<{ id: string }>("SELECT id FROM vp_presentations WHERE vp_hash = ?", [vpHash]);
  if (seen) throw new AppError(ErrorCode.REPLAY_DETECTED, "Presentation already used");

  // --- 2. Single-use nonce: consume atomically (burned even if later steps fail) ---
  const nonceRow = await db.transaction(async (tx) => {
    const row = await tx.queryOne<{ client_did: string; scope: string; expires_at: string; used: number }>(
      "SELECT client_did, scope, expires_at, used FROM presentation_nonces WHERE nonce = ?",
      [nonce]
    );
    if (!row) throw new AppError(ErrorCode.NONCE_INVALID, "Unknown nonce");
    if (row.used === 1) throw new AppError(ErrorCode.NONCE_INVALID, "Nonce already used");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new AppError(ErrorCode.NONCE_INVALID, "Nonce expired");
    await tx.execute("UPDATE presentation_nonces SET used = 1 WHERE nonce = ?", [nonce]);
    return row;
  });

  const clientDid = nonceRow.client_did;
  const requestedScope: string[] = JSON.parse(nonceRow.scope || "[]");

  // --- 3. Credential: verify VC signature, revocation, and holder binding ---
  let vcSubject: string | undefined;
  try {
    const jwks = createLocalJWKSet(getJWKS());
    await jwtVerify(vcJwt, jwks, { algorithms: ["RS256"] });
    vcSubject = (decodeJwt(vcJwt).sub as string) || undefined;
  } catch {
    throw new AppError(ErrorCode.VP_INVALID, "Credential signature invalid");
  }
  if (!vcSubject) throw new AppError(ErrorCode.VP_INVALID, "Credential has no subject");

  const credential = await getCredentialBySubject(vcSubject);
  if (!credential) throw new AppError(ErrorCode.VP_INVALID, "Credential not recognized");
  if (credential.revoked === 1) throw new AppError(ErrorCode.CREDENTIAL_REVOKED, "Credential revoked");
  if (credential.expires_at && new Date(credential.expires_at).getTime() < Date.now()) {
    throw new AppError(ErrorCode.CREDENTIAL_REVOKED, "Credential expired");
  }
  // Holder binding: the presenting wallet must be the one bound to this credential.
  if (!credential.wallet_did || credential.wallet_did !== walletDid) {
    throw new AppError(ErrorCode.VP_INVALID, "Presentation not bound to the credential holder");
  }
  const userId = credential.user_id;
  const vcOps: string[] = JSON.parse(credential.allowed_ops || "[]");

  // --- 4. Client must be registered and active ----------------------------
  const client = await getClient(clientDid);
  if (!client) throw new AppError(ErrorCode.FORBIDDEN, "Unknown client");
  if (!client.active) throw new AppError(ErrorCode.FORBIDDEN, "Client suspended");

  // --- 5. The user must have granted this agent (NO bypass) ---------------
  const grant = await getActiveGrant(userId, clientDid);
  if (!grant) {
    await logAudit({
      userId,
      action: "agent.present",
      resource: clientDid,
      status: "blocked",
      ipAddress,
      details: { reason: "no_active_grant" },
    });
    throw new AppError(ErrorCode.GRANT_MISSING, "User has not granted this agent");
  }

  // --- 6. Effective scope = VC ∩ client ∩ requested ∩ grant ---------------
  const effectiveScope = intersect(vcOps, client.allowedFunctions, requestedScope, grant.allowedFunctions);
  if (effectiveScope.length === 0) {
    throw new AppError(ErrorCode.SCOPE_DENIED, "No scope is permitted by all of credential, client, request, and grant");
  }

  // --- Mint the 90s scoped token + record the presentation ----------------
  const jti = uuidv4();
  const accessToken = await mintScopedToken(jti, walletDid, clientDid, effectiveScope, SCOPED_TOKEN_TTL_SECS);

  await db.execute(
    `INSERT INTO vp_presentations (id, user_id, client_did, vp_hash, nonce, scope_issued, token_jti, ip_address, presented_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), userId, clientDid, vpHash, nonce, JSON.stringify(effectiveScope), jti, ipAddress, new Date().toISOString()]
  );
  await recordMcpAudit({
    userId,
    agentDid: clientDid,
    toolName: "present",
    scopeUsed: effectiveScope,
    tokenJti: jti,
    ipAddress,
    resultStatus: "success",
  });
  await touchGrant(userId, clientDid);

  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: SCOPED_TOKEN_TTL_SECS,
    scope: effectiveScope,
    jti,
    userId,
    clientDid,
  };
}

// ---------------------------------------------------------------------------

export interface McpAuditInput {
  userId?: string | null;
  agentDid: string;
  toolName: string;
  scopeUsed?: string[];
  args?: Record<string, unknown>;
  resultStatus?: "success" | "denied" | "error";
  errorMessage?: string;
  tokenJti?: string;
  ipAddress?: string;
  durationMs?: number;
}

/** Append a row to the append-only mcp_audit_logs table. */
export async function recordMcpAudit(input: McpAuditInput): Promise<void> {
  await getDb().execute(
    `INSERT INTO mcp_audit_logs
       (id, user_id, agent_did, agent_type, tool_name, scope_used, args, result_status, error_message, token_jti, ip_address, duration_ms, called_at)
     VALUES (?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.userId ?? null,
      input.agentDid,
      input.toolName,
      JSON.stringify(input.scopeUsed ?? []),
      JSON.stringify(input.args ?? {}),
      input.resultStatus ?? "success",
      input.errorMessage ?? null,
      input.tokenJti ?? null,
      input.ipAddress ?? "",
      input.durationMs ?? null,
      new Date().toISOString(),
    ]
  );
}
