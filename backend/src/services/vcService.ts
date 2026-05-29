/**
 * Phase 2 — Verifiable Credential issuance and revocation.
 *
 * Issues W3C VC JWTs (signed with the platform RS256 key) and manages
 * revocation via BitstringStatusList. The credential data contract
 * (kycStatus, tier, allowedOps) is established here so Phase 3 (real KYC)
 * and Phase 7 (MCP VP gate) can consume it without schema changes.
 *
 * VC structure (per PRD Module 03 and W3C VC 1.1):
 *   issuer:               did:web:bankai.com#<kid>
 *   credentialSubject.id: did:web:bankai.com:users:<userId>
 *   credentialSubject:    { kycStatus, tier, allowedOps }
 *   credentialStatus:     BitstringStatusListEntry pointing to /api/credentials/status/:year
 */

import { v4 as uuidv4 } from "uuid";
import { SignJWT } from "jose";
import { getDb, type Db } from "../db";
import { config } from "../config";
import { getActiveKey, issuerDid, userDid } from "./didService";
import * as statusList from "./statusListService";
import { logAudit } from "./auditService";
import { AppError, ErrorCode } from "../errors";

const ALG = "RS256";

export type KycStatus = "PASSED" | "FAILED" | "PENDING";

export const DEFAULT_ALLOWED_OPS = [
  "balance:read",
  "transfer:low",
  "statement:read",
  "profile:read",
] as const;

export interface CredentialRow {
  id: string;
  user_id: string;
  vc_jwt: string | null;
  did_subject: string | null;
  status_index: number | null;
  allowed_ops: string;
  revoked: number;
  revoke_reason: string | null;
  issued_at: string;
  expires_at: string | null;
}

/**
 * Issue a new VC for a user.
 * If the user already has a non-revoked credential it is revoked first (re-issuance).
 * Returns the signed VC JWT string.
 */
export async function issueCredential(
  userId: string,
  tier: number,
  allowedOps: string[] = [...DEFAULT_ALLOWED_OPS],
  kycStatus: KycStatus = "PASSED"
): Promise<string> {
  const db = getDb();
  const key = getActiveKey();
  const year = new Date().getFullYear();

  return db.transaction(async (tx) => {
    // Revoke any existing non-revoked credential
    const existing = await tx.queryOne<CredentialRow>(
      "SELECT * FROM credentials WHERE user_id = ?",
      [userId]
    );
    if (existing && !existing.revoked) {
      await _revokeRow(tx, existing);
    }

    const index = await statusList.assignIndex(year, tx);
    const credId = uuidv4();
    const subject = userDid(userId);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 365 * 24 * 60 * 60; // 1 year

    const statusListUrl = `${config.CREDENTIAL_BASE_URL}/api/credentials/status/${year}`;

    const vcPayload = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/vc/status-list/2021/v1",
      ],
      type: ["VerifiableCredential", "BankAIKYCCredential"],
      id: `${config.CREDENTIAL_BASE_URL}/api/credentials/${credId}`,
      issuer: `${issuerDid}#${key.kid}`,
      credentialSubject: {
        id: subject,
        kycStatus,
        tier,
        allowedOps,
      },
      credentialStatus: {
        id: `${statusListUrl}#${index}`,
        type: "BitstringStatusListEntry",
        statusPurpose: "revocation",
        statusListIndex: String(index),
        statusListCredential: statusListUrl,
      },
    };

    const jwt = await new SignJWT({ vc: vcPayload })
      .setProtectedHeader({ alg: ALG, kid: key.kid, typ: "JWT" })
      .setSubject(subject)
      .setIssuer(`${issuerDid}#${key.kid}`)
      .setJti(credId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(key.privateKey);

    if (existing) {
      await tx.execute(
        `UPDATE credentials
         SET id = ?, vc_jwt = ?, did_subject = ?, status_index = ?, allowed_ops = ?,
             revoked = 0, revoke_reason = NULL, issued_at = ?, expires_at = ?
         WHERE user_id = ?`,
        [
          credId,
          jwt,
          subject,
          index,
          JSON.stringify(allowedOps),
          new Date().toISOString(),
          new Date(expiresAt * 1000).toISOString(),
          userId,
        ]
      );
    } else {
      await tx.execute(
        `INSERT INTO credentials (id, user_id, vc_jwt, did_subject, status_index, allowed_ops, revoked, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          credId,
          userId,
          jwt,
          subject,
          index,
          JSON.stringify(allowedOps),
          new Date().toISOString(),
          new Date(expiresAt * 1000).toISOString(),
        ]
      );
    }

    await logAudit({ userId, action: "credential.issue", resource: credId, details: { tier, index, year } });
    return jwt;
  });
}

/** Revoke the caller's own credential. */
export async function revokeCredential(credentialId: string, userId: string, reason: string): Promise<void> {
  const db = getDb();
  const row = await db.queryOne<CredentialRow>(
    "SELECT * FROM credentials WHERE id = ?",
    [credentialId]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Credential not found");
  if (row.user_id !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your credential");
  if (row.revoked) throw new AppError(ErrorCode.CONFLICT, "Credential already revoked");

  await _revokeRow(db, row, reason);
  await logAudit({ userId, action: "credential.revoke", resource: credentialId, details: { reason } });
}

/** Fetch the current credential for a user (null if none). */
export async function getCredential(userId: string): Promise<CredentialRow | null> {
  return getDb().queryOne<CredentialRow>(
    "SELECT * FROM credentials WHERE user_id = ?",
    [userId]
  );
}

// ---------------------------------------------------------------------------

async function _revokeRow(db: Db, row: CredentialRow, reason = "superseded"): Promise<void> {
  if (row.status_index !== null) {
    const year = new Date(row.issued_at).getFullYear();
    await statusList.revoke(year, row.status_index, db);
  }
  await db.execute(
    "UPDATE credentials SET revoked = 1, revoke_reason = ? WHERE id = ?",
    [reason, row.id]
  );
}
