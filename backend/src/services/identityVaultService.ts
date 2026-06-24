/**
 * Identity Vault — prototype relationship graph (PRODUCTION-STRATEGY §4).
 *
 * SQLite edge store today; Neo4j Aura is the prod swap. Fed from ledger transfers,
 * wallet binding, and onboarding signals. Graph features feed fraud-engine eval.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";

export type VaultRelationship = "TRANSACTED_WITH" | "SHARES_DEVICE" | "SHARES_BENEFICIARY" | "BOUND_WALLET";

export interface VaultEdge {
  id: string;
  fromUserId: string;
  toUserId: string;
  relationship: VaultRelationship;
  weightMinor: string;
  metadata: Record<string, unknown>;
  lastSeenAt: string;
}

interface RawEdge {
  id: string;
  from_user_id: string;
  to_user_id: string;
  relationship: VaultRelationship;
  weight_minor: string | number;
  metadata_json: string;
  last_seen_at: string;
}

function mapEdge(r: RawEdge): VaultEdge {
  return {
    id: r.id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    relationship: r.relationship,
    weightMinor: BigInt(r.weight_minor).toString(),
    metadata: JSON.parse(r.metadata_json || "{}"),
    lastSeenAt: r.last_seen_at,
  };
}

export function assertIdentityVaultEnabled(): void {
  if (!config.IDENTITY_VAULT_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Identity Vault is disabled");
  }
}

/** Upsert a directed relationship edge (idempotent on from+to+rel). */
export async function upsertEdge(input: {
  fromUserId: string;
  toUserId: string;
  relationship: VaultRelationship;
  weightDeltaMinor?: bigint;
  metadata?: Record<string, unknown>;
}): Promise<VaultEdge> {
  assertIdentityVaultEnabled();
  if (input.fromUserId === input.toUserId) {
    throw new AppError(ErrorCode.VALIDATION, "Cannot link a user to themselves");
  }

  const db = getDb();
  const existing = await db.queryOne<RawEdge>(
    "SELECT * FROM identity_vault_edges WHERE from_user_id = ? AND to_user_id = ? AND relationship = ?",
    [input.fromUserId, input.toUserId, input.relationship]
  );

  const now = new Date().toISOString();
  const delta = input.weightDeltaMinor ?? 0n;

  if (existing) {
    const newWeight = BigInt(existing.weight_minor) + delta;
    await db.execute(
      `UPDATE identity_vault_edges SET weight_minor = ?, metadata_json = ?, last_seen_at = ? WHERE id = ?`,
      [newWeight.toString(), JSON.stringify(input.metadata ?? JSON.parse(existing.metadata_json)), now, existing.id]
    );
    const row = await db.queryOne<RawEdge>("SELECT * FROM identity_vault_edges WHERE id = ?", [existing.id]);
    return mapEdge(row!);
  }

  const id = uuidv4();
  await db.execute(
    `INSERT INTO identity_vault_edges (id, from_user_id, to_user_id, relationship, weight_minor, metadata_json, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.fromUserId, input.toUserId, input.relationship, delta.toString(), JSON.stringify(input.metadata ?? {}), now, now]
  );
  const row = await db.queryOne<RawEdge>("SELECT * FROM identity_vault_edges WHERE id = ?", [id]);
  return mapEdge(row!);
}

/** Rebuild TRANSACTED_WITH edges from recent user-to-user ledger transfers. */
export async function syncFromLedger(limit = 500): Promise<{ edgesUpserted: number }> {
  assertIdentityVaultEnabled();
  const db = getDb();
  const rows = await db.query<{ from_acct: string; to_acct: string; total_minor: string }>(
    `SELECT le_debit.ledger_account_id AS from_acct, le_credit.ledger_account_id AS to_acct,
            CAST(SUM(le_debit.amount_minor) AS TEXT) AS total_minor
       FROM ledger_journals j
       JOIN ledger_entries le_debit ON le_debit.journal_id = j.id AND le_debit.direction = 'debit'
       JOIN ledger_entries le_credit ON le_credit.journal_id = j.id AND le_credit.direction = 'credit'
       JOIN ledger_accounts la_from ON la_from.id = le_debit.ledger_account_id AND la_from.kind = 'user_cash' AND la_from.user_id IS NOT NULL
       JOIN ledger_accounts la_to ON la_to.id = le_credit.ledger_account_id AND la_to.kind = 'user_cash' AND la_to.user_id IS NOT NULL
      WHERE j.description LIKE '%transfer%' OR j.description LIKE '%Transfer%'
      GROUP BY le_debit.ledger_account_id, le_credit.ledger_account_id
      LIMIT ?`,
    [limit]
  );

  let edgesUpserted = 0;
  for (const r of rows) {
    const fromUser = await db.queryOne<{ user_id: string }>(
      "SELECT user_id FROM ledger_accounts WHERE id = ? AND user_id IS NOT NULL",
      [r.from_acct]
    );
    const toUser = await db.queryOne<{ user_id: string }>(
      "SELECT user_id FROM ledger_accounts WHERE id = ? AND user_id IS NOT NULL",
      [r.to_acct]
    );
    if (!fromUser?.user_id || !toUser?.user_id || fromUser.user_id === toUser.user_id) continue;
    await upsertEdge({
      fromUserId: fromUser.user_id,
      toUserId: toUser.user_id,
      relationship: "TRANSACTED_WITH",
      weightDeltaMinor: BigInt(r.total_minor),
      metadata: { source: "ledger_sync" },
    });
    edgesUpserted++;
  }

  await logAudit({ action: "identity_vault.sync", resource: "ledger", details: { edgesUpserted } });
  return { edgesUpserted };
}

/** Neighborhood for fraud/compliance (1-hop outbound + inbound). */
export async function getNeighborhood(userId: string): Promise<{ edges: VaultEdge[]; sharedDevicePeers: string[] }> {
  assertIdentityVaultEnabled();
  const db = getDb();
  const rows = await db.query<RawEdge>(
    `SELECT * FROM identity_vault_edges
     WHERE from_user_id = ? OR to_user_id = ?
     ORDER BY last_seen_at DESC LIMIT 200`,
    [userId, userId]
  );

  const devicePeers = new Set<string>();
  for (const r of rows) {
    if (r.relationship !== "SHARES_DEVICE") continue;
    const peer = r.from_user_id === userId ? r.to_user_id : r.from_user_id;
    devicePeers.add(peer);
  }

  return { edges: rows.map(mapEdge), sharedDevicePeers: [...devicePeers] };
}

/** Graph feature vector for fraud-engine (velocity proxy + cluster size). */
export async function graphFeaturesForUser(userId: string): Promise<{
  outboundCount: number;
  inboundCount: number;
  transactedWeightMinor: string;
  sharedDeviceCount: number;
}> {
  assertIdentityVaultEnabled();
  const { edges, sharedDevicePeers } = await getNeighborhood(userId);
  let outbound = 0;
  let inbound = 0;
  let weight = 0n;
  for (const e of edges) {
    if (e.relationship === "TRANSACTED_WITH") {
      if (e.fromUserId === userId) {
        outbound++;
        weight += BigInt(e.weightMinor);
      } else inbound++;
    }
  }
  return {
    outboundCount: outbound,
    inboundCount: inbound,
    transactedWeightMinor: weight.toString(),
    sharedDeviceCount: sharedDevicePeers.length,
  };
}
