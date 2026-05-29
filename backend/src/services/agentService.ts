/**
 * Phase 3 — Internal agent service.
 *
 * Users can create named internal agents with scoped permissions and a
 * transfer limit cap. Phase 7 (MCP) uses these same agents for external
 * access gated by VP verification.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getProfile } from "./identityService";

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  type: string;
  permissions: string;
  transfer_limit_minor: number;
  currency: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  permissions?: string[];
  transfer_limit_minor?: number;
  expires_at?: string;
}

const DEFAULT_PERMISSIONS = ["balance:read", "profile:read"]; // safe for all tiers (Tier 0 minimum)
const MAX_TRANSFER_MINOR = 100_000; // $1,000.00

const TIER_OPS: Record<number, string[]> = {
  0: ["balance:read", "profile:read"],
  1: ["balance:read", "statement:read", "profile:read"],
  2: ["balance:read", "transfer:low", "statement:read", "profile:read"],
  3: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read"],
  4: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read", "lending:read"],
};

async function assertPermissionsWithinTier(userId: string, permissions: string[]): Promise<void> {
  const profile = await getProfile(userId);
  const allowed = new Set(TIER_OPS[profile?.tier ?? 0] ?? []);
  const forbidden = permissions.filter((p) => !allowed.has(p));
  if (forbidden.length > 0) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      `Permissions exceed your identity tier: ${forbidden.join(", ")}`
    );
  }
}

export async function createAgent(userId: string, input: CreateAgentInput): Promise<AgentRow> {
  const db = getDb();
  const id = uuidv4();
  const permissions = input.permissions ?? DEFAULT_PERMISSIONS;
  await assertPermissionsWithinTier(userId, permissions);
  const transferLimit = Math.min(input.transfer_limit_minor ?? 50_000, MAX_TRANSFER_MINOR);

  await db.execute(
    `INSERT INTO agents (id, user_id, name, description, type, permissions, transfer_limit_minor, currency, status, expires_at)
     VALUES (?, ?, ?, ?, 'internal', ?, ?, 'USD', 'active', ?)`,
    [id, userId, input.name, input.description ?? "", JSON.stringify(permissions), transferLimit, input.expires_at ?? null]
  );

  await logAudit({ userId, action: "agent.create", resource: id, details: { name: input.name, permissions } });
  return (await getAgent(userId, id))!;
}

export async function listAgents(userId: string): Promise<AgentRow[]> {
  return getDb().query<AgentRow>(
    "SELECT * FROM agents WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC",
    [userId]
  );
}

export async function getAgent(userId: string, agentId: string): Promise<AgentRow | null> {
  return getDb().queryOne<AgentRow>(
    "SELECT * FROM agents WHERE id = ? AND user_id = ? AND status != 'deleted'",
    [agentId, userId]
  );
}

export async function updateAgent(
  userId: string,
  agentId: string,
  patch: Partial<CreateAgentInput>
): Promise<AgentRow> {
  const db = getDb();
  const agent = await getAgent(userId, agentId);
  if (!agent) throw new AppError(ErrorCode.NOT_FOUND, "Agent not found");

  const fields: string[] = [];
  const vals: unknown[] = [];

  if (patch.name !== undefined) { fields.push("name = ?"); vals.push(patch.name); }
  if (patch.description !== undefined) { fields.push("description = ?"); vals.push(patch.description); }
  if (patch.permissions !== undefined) {
    await assertPermissionsWithinTier(userId, patch.permissions);
    fields.push("permissions = ?");
    vals.push(JSON.stringify(patch.permissions));
  }
  if (patch.transfer_limit_minor !== undefined) {
    fields.push("transfer_limit_minor = ?");
    vals.push(Math.min(patch.transfer_limit_minor, MAX_TRANSFER_MINOR));
  }
  if (patch.expires_at !== undefined) { fields.push("expires_at = ?"); vals.push(patch.expires_at); }

  if (fields.length > 0) {
    vals.push(agentId);
    await db.execute(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`, vals);
    await logAudit({ userId, action: "agent.update", resource: agentId, details: patch });
  }

  return (await getAgent(userId, agentId))!;
}

export async function deleteAgent(userId: string, agentId: string): Promise<void> {
  const db = getDb();
  const agent = await getAgent(userId, agentId);
  if (!agent) throw new AppError(ErrorCode.NOT_FOUND, "Agent not found");
  await db.execute("UPDATE agents SET status = 'deleted' WHERE id = ?", [agentId]);
  await logAudit({ userId, action: "agent.delete", resource: agentId });
}
