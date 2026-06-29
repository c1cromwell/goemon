/**
 * Phase 24.1 — x401 HTTP Proof Requirement (Argus-native, issuer-neutral).
 *
 * Maps Proof's x401 header flow onto the existing OID4VP gate (presentationService).
 * Default issuer: Argus W3C VC + wallet did:key — no Proof.com dependency required.
 */

import { createHash, randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { issueNonce, verifyPresentation, type PresentationChallenge, type ScopedTokenResult } from "./presentationService";
import { recordVerifiableIntent } from "./verifiableIntentService";

export const X401_HEADER_REQUIRED = "PROOF-REQUIRED";
export const X401_HEADER_PRESENTATION = "PROOF-PRESENTATION";
export const X401_HEADER_RESPONSE = "PROOF-RESPONSE";
export const X401_VERIFICATION_TOKEN_HEADER = "PROOF-VERIFICATION-TOKEN";

const VERIFICATION_TOKEN_TTL_SECS = 300;

export interface X401RequirementPayload {
  version: "0.2.0";
  verifier: string;
  presentation_requirements: {
    client_did: string;
    scope: string[];
    aud: string;
    nonce: string;
    expires_at: string;
  };
}

export interface X401PresentationPayload {
  vp_jwt: string;
}

export interface X401VerificationToken {
  token: string;
  expiresIn: number;
  scope: string[];
  userId: string;
  clientDid: string;
}

function assertX401Enabled(): void {
  if (!config.X401_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "x401 identity proof is not enabled");
  }
}

export function encodeProofRequired(payload: X401RequirementPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeProofRequired(headerValue: string): X401RequirementPayload {
  try {
    const json = Buffer.from(headerValue, "base64url").toString("utf8");
    return JSON.parse(json) as X401RequirementPayload;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "Invalid PROOF-REQUIRED header encoding");
  }
}

export function encodeProofPresentation(payload: X401PresentationPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeProofPresentation(headerValue: string): X401PresentationPayload {
  try {
    const json = Buffer.from(headerValue, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as X401PresentationPayload;
    if (!parsed.vp_jwt) throw new Error("missing vp_jwt");
    return parsed;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "Invalid PROOF-PRESENTATION header encoding");
  }
}

export function buildProofResponse(error: { code: string; message: string }): string {
  return Buffer.from(JSON.stringify({ ok: false, error }), "utf8").toString("base64url");
}

/** Issue an x401 challenge for a registered MCP client DID + scope list. */
export async function issueProofRequirement(
  clientDid: string,
  scope: string[],
  ttlSecs = 300
): Promise<{ header: string; challenge: PresentationChallenge; payload: X401RequirementPayload }> {
  assertX401Enabled();
  if (!clientDid) throw new AppError(ErrorCode.VALIDATION, "clientDid required");
  const challenge = await issueNonce(clientDid, scope, ttlSecs);
  const payload: X401RequirementPayload = {
    version: "0.2.0",
    verifier: config.BASE_URL,
    presentation_requirements: {
      client_did: clientDid,
      scope,
      aud: challenge.aud,
      nonce: challenge.nonce,
      expires_at: challenge.expiresAt,
    },
  };
  return { header: encodeProofRequired(payload), challenge, payload };
}

/** Verify PROOF-PRESENTATION and mint the standard 90s scoped token + reusable verification token. */
export async function verifyProofPresentation(input: {
  presentationHeader: string;
  ipAddress?: string;
}): Promise<{ scoped: ScopedTokenResult; verification: X401VerificationToken }> {
  assertX401Enabled();
  const { vp_jwt } = decodeProofPresentation(input.presentationHeader);
  const scoped = await verifyPresentation({ vpJwt: vp_jwt, ipAddress: input.ipAddress });
  await recordVerifiableIntent({
    userId: scoped.userId,
    scope: scoped.scope,
    action: "x401.present",
    vpHash: undefined,
  });
  const verification = await storeVerificationToken(scoped);
  return { scoped, verification };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function storeVerificationToken(scoped: ScopedTokenResult): Promise<X401VerificationToken> {
  const raw = randomBytes(32).toString("base64url");
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECS * 1000).toISOString();
  await getDb().execute(
    `INSERT INTO x401_verification_tokens
       (id, token_hash, user_id, client_did, scope_json, jti, expires_at, consumed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      hashToken(raw),
      scoped.userId,
      scoped.clientDid,
      JSON.stringify(scoped.scope),
      scoped.jti,
      expiresAt,
      new Date().toISOString(),
    ]
  );
  return {
    token: raw,
    expiresIn: VERIFICATION_TOKEN_TTL_SECS,
    scope: scoped.scope,
    userId: scoped.userId,
    clientDid: scoped.clientDid,
  };
}

/** Exchange a verification token (x401 leg 4) for the underlying scoped bearer token metadata. */
export async function redeemVerificationToken(token: string): Promise<{
  userId: string;
  clientDid: string;
  scope: string[];
  jti: string;
}> {
  assertX401Enabled();
  const row = await getDb().queryOne<{
    user_id: string;
    client_did: string;
    scope_json: string;
    jti: string;
    expires_at: string;
    consumed: number;
  }>("SELECT user_id, client_did, scope_json, jti, expires_at, consumed FROM x401_verification_tokens WHERE token_hash = ?", [
    hashToken(token),
  ]);
  if (!row) throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid verification token");
  if (row.consumed === 1) throw new AppError(ErrorCode.REPLAY_DETECTED, "Verification token already used");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Verification token expired");
  }
  await getDb().execute("UPDATE x401_verification_tokens SET consumed = 1 WHERE token_hash = ?", [hashToken(token)]);
  return {
    userId: row.user_id,
    clientDid: row.client_did,
    scope: JSON.parse(row.scope_json) as string[],
    jti: row.jti,
  };
}
