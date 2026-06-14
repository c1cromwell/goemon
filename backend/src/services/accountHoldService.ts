/**
 * Phase 20 — account holds (the fraud-remediation state).
 *
 * The standalone fraud engine calls back here (via /api/internal/remediation) to
 * freeze an account or flag a transaction when an async decision is severe. A
 * "frozen" account is NOT a mutable boolean — it DERIVES from the append-only
 * `account_holds` log: frozen ⇔ there are more `place` events than `release`
 * events. This mirrors how a payment's status derives from its escrow row.
 *
 * `isAccountFrozen` is enforced on the money path (transferService, paymentService)
 * and is the deterministic gate the (advisory) remote model can trigger but never
 * bypass.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { logAudit } from "./auditService";
import { accountHoldTotal } from "../observability/metrics";

export type HoldSource = "fraud_engine" | "admin" | "compliance";

/** True when the user has an unreleased hold. */
export async function isAccountFrozen(userId: string): Promise<boolean> {
  const row = await getDb().queryOne<{ places: number; releases: number }>(
    `SELECT
        SUM(CASE WHEN action = 'place'   THEN 1 ELSE 0 END) AS places,
        SUM(CASE WHEN action = 'release' THEN 1 ELSE 0 END) AS releases
       FROM account_holds WHERE user_id = ?`,
    [userId]
  );
  return Number(row?.places ?? 0) > Number(row?.releases ?? 0);
}

/**
 * Place a hold (freeze). Idempotent on decisionId: a repeated callback for the
 * same engine decision is a no-op, so retried remediation never double-freezes.
 */
export async function placeHold(args: {
  userId: string;
  reason: string;
  source: HoldSource;
  decisionId?: string;
}): Promise<{ applied: boolean }> {
  const db = getDb();
  if (args.decisionId) {
    const existing = await db.queryOne<{ id: string }>(
      "SELECT id FROM account_holds WHERE action = 'place' AND decision_id = ?",
      [args.decisionId]
    );
    if (existing) return { applied: false };
  }
  await db.execute(
    `INSERT INTO account_holds (id, user_id, action, reason, source, decision_id, created_at)
     VALUES (?, ?, 'place', ?, ?, ?, ?)`,
    [uuidv4(), args.userId, args.reason, args.source, args.decisionId ?? null, new Date().toISOString()]
  );
  accountHoldTotal.inc({ action: "place", source: args.source });
  await logAudit({
    userId: args.userId,
    action: "account_freeze",
    resource: args.decisionId ?? args.userId,
    status: "blocked",
    details: { reason: args.reason, source: args.source },
  });
  return { applied: true };
}

/** Release all holds for a user (idempotent on decisionId for the release event). */
export async function releaseHold(args: {
  userId: string;
  reason: string;
  source: HoldSource;
  decisionId?: string;
}): Promise<{ applied: boolean }> {
  const db = getDb();
  if (!(await isAccountFrozen(args.userId))) return { applied: false };
  await db.execute(
    `INSERT INTO account_holds (id, user_id, action, reason, source, decision_id, created_at)
     VALUES (?, ?, 'release', ?, ?, ?, ?)`,
    [uuidv4(), args.userId, args.reason, args.source, args.decisionId ?? null, new Date().toISOString()]
  );
  accountHoldTotal.inc({ action: "release", source: args.source });
  await logAudit({
    userId: args.userId,
    action: "account_unfreeze",
    resource: args.decisionId ?? args.userId,
    status: "success",
    details: { reason: args.reason, source: args.source },
  });
  return { applied: true };
}

/** Flag a specific transaction for analyst review. */
export async function flagTransaction(args: {
  userId: string;
  transactionRef: string;
  reason: string;
  source: HoldSource;
  decisionId?: string;
}): Promise<void> {
  await getDb().execute(
    `INSERT INTO transaction_flags (id, user_id, transaction_ref, reason, source, decision_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), args.userId, args.transactionRef, args.reason, args.source, args.decisionId ?? null, new Date().toISOString()]
  );
  accountHoldTotal.inc({ action: "flag", source: args.source });
  await logAudit({
    userId: args.userId,
    action: "transaction_flag",
    resource: args.transactionRef,
    status: "success",
    details: { reason: args.reason, source: args.source, flagged: true },
  });
}
