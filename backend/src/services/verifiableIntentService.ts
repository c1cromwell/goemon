/**
 * Phase 24.1d — Verifiable intent binding (AP2-shaped authorization records).
 */

import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export interface VerifiableIntentInput {
  userId: string;
  scope: string[];
  action: string;
  resource?: string;
  amountMinor?: string;
  currency?: string;
  vpHash?: string;
}

export function hashIntentPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function recordVerifiableIntent(input: VerifiableIntentInput): Promise<{ id: string; intentHash: string }> {
  if (!config.X401_ENABLED) throw new AppError(ErrorCode.NOT_IMPLEMENTED, "x401 disabled");
  const payload = {
    action: input.action,
    resource: input.resource ?? null,
    amountMinor: input.amountMinor ?? null,
    currency: input.currency ?? null,
    scope: input.scope,
    at: new Date().toISOString(),
  };
  const intentHash = hashIntentPayload(payload);
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO verifiable_intents (id, user_id, intent_hash, vp_hash, scope_json, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, intentHash, input.vpHash ?? null, JSON.stringify(input.scope), JSON.stringify(payload), new Date().toISOString()]
  );
  return { id, intentHash };
}

export async function listVerifiableIntents(userId: string, limit = 20): Promise<Array<{ id: string; intentHash: string; createdAt: string }>> {
  const rows = await getDb().query<{ id: string; intent_hash: string; created_at: string }>(
    "SELECT id, intent_hash, created_at FROM verifiable_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, Math.min(limit, 100)]
  );
  return rows.map((r) => ({ id: r.id, intentHash: r.intent_hash, createdAt: r.created_at }));
}
