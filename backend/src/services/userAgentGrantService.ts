/**
 * Phase 7 — User → agent grants.
 *
 * Before any external agent can act for a user, the USER must explicitly grant it
 * (allowed functions + a per-transfer ceiling). This grant is one of the four
 * sets intersected to compute effective scope, and presentationService treats a
 * missing/inactive grant as a hard denial (GRANT_MISSING) — there is no bypass,
 * even with an otherwise-valid Verifiable Presentation.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";

export interface UserAgentGrantRow {
  id: string;
  user_id: string;
  agent_did: string;
  display_name: string;
  description: string;
  allowed_functions: string; // JSON array of scope strings
  max_transfer_minor: number;
  currency: string;
  active: number;
  granted_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface UserAgentGrant {
  id: string;
  userId: string;
  agentDid: string;
  displayName: string;
  description: string;
  allowedFunctions: string[];
  maxTransferMinor: bigint;
  currency: string;
  active: boolean;
  grantedAt: string;
  lastUsedAt: string | null;
}

function toGrant(row: UserAgentGrantRow): UserAgentGrant {
  return {
    id: row.id,
    userId: row.user_id,
    agentDid: row.agent_did,
    displayName: row.display_name,
    description: row.description,
    allowedFunctions: JSON.parse(row.allowed_functions || "[]"),
    maxTransferMinor: BigInt(row.max_transfer_minor ?? 0),
    currency: row.currency,
    active: row.active === 1,
    grantedAt: row.granted_at,
    lastUsedAt: row.last_used_at,
  };
}

export interface GrantInput {
  userId: string;
  agentDid: string;
  displayName: string;
  description?: string;
  allowedFunctions: string[];
  maxTransferMinor: bigint;
  currency?: string;
}

/** Create or update (re-grant) a user's grant to an agent. */
export async function grantAgent(input: GrantInput): Promise<UserAgentGrant> {
  if (!input.agentDid) throw new AppError(ErrorCode.VALIDATION, "agentDid required");
  if (input.maxTransferMinor < 0n) throw new AppError(ErrorCode.VALIDATION, "maxTransferMinor must be >= 0");

  const db = getDb();
  const existing = await db.queryOne<UserAgentGrantRow>(
    "SELECT * FROM user_agent_grants WHERE user_id = ? AND agent_did = ?",
    [input.userId, input.agentDid]
  );

  if (existing) {
    await db.execute(
      `UPDATE user_agent_grants
         SET display_name = ?, description = ?, allowed_functions = ?, max_transfer_minor = ?,
             currency = ?, active = 1, granted_at = ?, revoked_at = NULL, revoke_reason = NULL
       WHERE user_id = ? AND agent_did = ?`,
      [
        input.displayName,
        input.description ?? "",
        JSON.stringify(input.allowedFunctions),
        input.maxTransferMinor.toString(),
        input.currency ?? "USD",
        new Date().toISOString(),
        input.userId,
        input.agentDid,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO user_agent_grants
         (id, user_id, agent_did, display_name, description, allowed_functions, max_transfer_minor, currency, active, granted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        uuidv4(),
        input.userId,
        input.agentDid,
        input.displayName,
        input.description ?? "",
        JSON.stringify(input.allowedFunctions),
        input.maxTransferMinor.toString(),
        input.currency ?? "USD",
        new Date().toISOString(),
      ]
    );
  }

  await logAudit({
    userId: input.userId,
    action: "agent.grant",
    resource: input.agentDid,
    details: { allowedFunctions: input.allowedFunctions, maxTransferMinor: input.maxTransferMinor.toString() },
  });
  return (await getActiveGrant(input.userId, input.agentDid))!;
}

/** The active grant for (user, agent), or null if none / revoked. */
export async function getActiveGrant(userId: string, agentDid: string): Promise<UserAgentGrant | null> {
  const row = await getDb().queryOne<UserAgentGrantRow>(
    "SELECT * FROM user_agent_grants WHERE user_id = ? AND agent_did = ? AND active = 1",
    [userId, agentDid]
  );
  return row ? toGrant(row) : null;
}

export async function listGrants(userId: string): Promise<UserAgentGrant[]> {
  const rows = await getDb().query<UserAgentGrantRow>(
    "SELECT * FROM user_agent_grants WHERE user_id = ? ORDER BY granted_at DESC",
    [userId]
  );
  return rows.map(toGrant);
}

export async function revokeGrant(userId: string, agentDid: string, reason = "user_requested"): Promise<void> {
  const db = getDb();
  const row = await db.queryOne<UserAgentGrantRow>(
    "SELECT * FROM user_agent_grants WHERE user_id = ? AND agent_did = ?",
    [userId, agentDid]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Grant not found");
  await db.execute(
    "UPDATE user_agent_grants SET active = 0, revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND agent_did = ?",
    [new Date().toISOString(), reason, userId, agentDid]
  );
  await logAudit({ userId, action: "agent.revoke", resource: agentDid, details: { reason }, status: "blocked" });
}

/** Stamp last_used_at after a successful presentation (best-effort). */
export async function touchGrant(userId: string, agentDid: string): Promise<void> {
  await getDb().execute(
    "UPDATE user_agent_grants SET last_used_at = ? WHERE user_id = ? AND agent_did = ?",
    [new Date().toISOString(), userId, agentDid]
  );
}
