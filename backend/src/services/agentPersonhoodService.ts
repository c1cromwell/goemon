/**
 * Feature A — Agent-Personhood Attestation.
 *
 * The report's flagged frontier: "proving personhood when software agents move money."
 * When a user grants an agent, if that user is a KYC-verified human (holds a non-revoked
 * GoemonKYCCredential) we mint a JWKS-verifiable attestation binding:
 *
 *   the human (user DID) → the agent (client DID) → the holder-bound wallet did:key
 *   → the authorized scope, signed by the platform issuer key.
 *
 * presentationService consults it before minting a scoped token and stamps a
 * `personhood: verified_human` claim on that token, so a downstream merchant /
 * counterparty can rely on "a real, KYC-verified human stands behind this paying agent."
 *
 * Best-effort by design: minting never blocks a grant (a non-KYC user simply gets no
 * attestation → `unverified`). Enforcement (deny without an attestation) is opt-in via
 * AGENT_PERSONHOOD_ENFORCED + the client's require_user_approval flag.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { getCredential } from "./vcService";
import { userDid } from "./didService";
import { signIssuerJwt } from "../utils/tokenFactory";
import { logAudit } from "./auditService";
import { logger } from "../observability/logger";

export type PersonhoodLevel = "verified_human" | "unverified";

export interface AttestationRow {
  id: string;
  user_id: string;
  agent_did: string;
  wallet_did: string | null;
  credential_id: string | null;
  personhood_level: string;
  scope: string;
  attestation_jwt: string;
  active: number;
  issued_at: string;
  revoked_at: string | null;
}

export interface MintAttestationInput {
  userId: string;
  agentDid: string;
  walletDid?: string | null;
  scope: string[];
}

export interface MintedAttestation {
  id: string;
  level: PersonhoodLevel;
  jwt: string;
}

/**
 * Mint (or replace) the personhood attestation for (user, agent). Returns null when the
 * user is not a KYC-verified human, or on any signing/store failure — grantAgent treats
 * this as best-effort and never fails because of it.
 */
export async function mintAttestation(input: MintAttestationInput): Promise<MintedAttestation | null> {
  try {
    const cred = await getCredential(input.userId);
    if (!cred || cred.revoked) return null; // not a verified human → no attestation

    const walletDid = input.walletDid ?? cred.wallet_did ?? null;
    const subject = userDid(input.userId);
    const jwt = await signIssuerJwt(
      {
        type: ["VerifiableCredential", "AgentAuthorizationCredential"],
        personhood: "verified_human",
        credentialSubject: {
          id: subject, // the human — personhood anchor
          agent: input.agentDid, // the authorized agent
          walletDid, // the holder-bound wallet key that signs the agent's VPs
          authorizedScope: input.scope,
        },
      },
      { subject, type: "JWT" }
    );

    const db = getDb();
    const now = new Date().toISOString();
    const existing = await db.queryOne<{ id: string }>(
      "SELECT id FROM agent_personhood_attestations WHERE user_id = ? AND agent_did = ?",
      [input.userId, input.agentDid]
    );
    const id = existing?.id ?? uuidv4();
    if (existing) {
      await db.execute(
        `UPDATE agent_personhood_attestations
           SET wallet_did = ?, credential_id = ?, personhood_level = 'verified_human',
               scope = ?, attestation_jwt = ?, active = 1, issued_at = ?, revoked_at = NULL
         WHERE id = ?`,
        [walletDid, cred.id, JSON.stringify(input.scope), jwt, now, id]
      );
    } else {
      await db.execute(
        `INSERT INTO agent_personhood_attestations
           (id, user_id, agent_did, wallet_did, credential_id, personhood_level, scope, attestation_jwt, active, issued_at)
         VALUES (?, ?, ?, ?, ?, 'verified_human', ?, ?, 1, ?)`,
        [id, input.userId, input.agentDid, walletDid, cred.id, JSON.stringify(input.scope), jwt, now]
      );
    }

    await logAudit({
      userId: input.userId,
      action: "agent.personhood.attest",
      resource: input.agentDid,
      details: { credentialId: cred.id, level: "verified_human" },
    });
    return { id, level: "verified_human", jwt };
  } catch (e) {
    // Never let attestation minting break a grant — log and move on.
    logger.warn({ err: e, userId: input.userId, agentDid: input.agentDid }, "personhood attestation mint failed (best-effort)");
    return null;
  }
}

/** The active attestation for (user, agent), or null. */
export async function getActiveAttestation(userId: string, agentDid: string): Promise<AttestationRow | null> {
  return getDb().queryOne<AttestationRow>(
    "SELECT * FROM agent_personhood_attestations WHERE user_id = ? AND agent_did = ? AND active = 1",
    [userId, agentDid]
  );
}

/** The personhood level for (user, agent): verified_human iff an active attestation exists. */
export async function personhoodLevelFor(userId: string, agentDid: string): Promise<PersonhoodLevel> {
  const row = await getActiveAttestation(userId, agentDid);
  return row ? "verified_human" : "unverified";
}

/** Revoke the attestation when a grant is revoked (best-effort). */
export async function revokeAttestation(userId: string, agentDid: string): Promise<void> {
  await getDb().execute(
    "UPDATE agent_personhood_attestations SET active = 0, revoked_at = ? WHERE user_id = ? AND agent_did = ? AND active = 1",
    [new Date().toISOString(), userId, agentDid]
  );
}
