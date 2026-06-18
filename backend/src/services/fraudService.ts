/**
 * Stage 1 fraud seam — in-process, prototype-scale fraud screening of the money path.
 *
 * This is the deliberately small first slice of docs/business/FraudEngine.md, shaped
 * so it grows into the streaming target without rework:
 *
 *   RiskEvent  → scoreTransfer (deterministic rules)  → FraudDecision (score+action)
 *              → record to append-only fraud_decisions ("audit topic" analog)
 *              → enforce (block throws FRAUD_BLOCKED)
 *
 * Invariant (mirrors onboarding's assessRisk→finalizeDecision): the score is ADVISORY;
 * the deterministic thresholds here are the only thing that blocks. When a real
 * Transformer model lands, it replaces scoreTransfer and feeds the same decision/
 * enforcement/audit contract — model_version moves off 'rules-v0'.
 *
 * The scorer reads only derived facts from the existing `transactions` ledger view
 * (velocity, trailing max, prior-payee), never raw PII.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb, type Db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { fraudDecisionTotal } from "../observability/metrics";
import { getFraudClient, type RemoteDecision } from "./fraudClient";

export type FraudAction = "allow" | "flag" | "challenge" | "block";

/** Severity ordering — used to merge the local (advisory) and remote (advisory)
 *  opinions: the effective action is the MORE severe of the two, so the remote
 *  engine can only RAISE scrutiny, never silently un-block. */
const SEVERITY: Record<string, number> = { allow: 0, flag: 1, challenge: 2, block: 3, freeze: 4 };

/** Map a remote action onto the sync money-gate vocabulary: an inline transfer
 *  cannot be "frozen" (that is a standing, async remediation) — it blocks. */
function clampSync(action: string): FraudAction {
  if (action === "freeze") return "block";
  if (action === "allow" || action === "flag" || action === "challenge" || action === "block") return action;
  return "allow";
}

/** The model identifier recorded with every decision. Rules today; a served
 *  Transformer version later (FraudEngine.md target). */
export const FRAUD_MODEL_VERSION = "rules-v0";

/** Velocity window: transfers by the same user inside this many seconds. */
const VELOCITY_WINDOW_SECS = 60;

/** Score thresholds (0..1) → action. Block requires a genuinely anomalous combo. */
const BLOCK_AT = 0.8;
const CHALLENGE_AT = 0.5;
const FLAG_AT = 0.25;

export interface Reason {
  code: string;
  weight: number;
}

/** A normalized money-path event. In Stage 2 this becomes a Kafka record. */
export interface TransferRiskEvent {
  eventType: "transfer.send" | "bank.withdraw" | "card.auth";
  channel: string; // api | smartchat | mcp | bank | card
  userId: string;
  counterpartyId: string;
  /** Resolved ledger account ids — used for prior-payee derivation. */
  fromAccountId: string;
  toAccountId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey?: string;
}

export interface FraudDecision {
  action: FraudAction;
  /** 0..1, advisory. */
  score: number;
  reasons: Reason[];
  modelVersion: string;
}

interface TransferFeatures {
  /** Count of the user's transfer_out in the velocity window. */
  velocity: number;
  /** True when the user has never sent to this recipient account before. */
  newPayee: boolean;
  /** Largest prior transfer_out amount by the user (0 when none). */
  trailingMaxMinor: bigint;
}

async function gatherFeatures(ev: TransferRiskEvent, db: Db): Promise<TransferFeatures> {
  const windowStart = new Date(Date.now() - VELOCITY_WINDOW_SECS * 1000).toISOString();

  const vel = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM transactions
       WHERE user_id = ? AND type = 'transfer_out' AND created_at >= ?`,
    [ev.userId, windowStart]
  );

  const payee = await db.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM transactions
       WHERE user_id = ? AND type = 'transfer_out' AND to_account_id = ?`,
    [ev.userId, ev.toAccountId]
  );

  const max = await db.queryOne<{ m: string | number | null }>(
    `SELECT MAX(amount_minor) AS m FROM transactions
       WHERE user_id = ? AND type = 'transfer_out'`,
    [ev.userId]
  );

  return {
    velocity: Number(vel?.c ?? 0),
    newPayee: Number(payee?.c ?? 0) === 0,
    trailingMaxMinor: max?.m == null ? 0n : BigInt(max.m),
  };
}

/**
 * Deterministic, rule-based risk score for a transfer. Pure given features +
 * amount, so it is fully testable offline (the FraudEngine.md scorer is the
 * eventual drop-in replacement behind this same signature).
 */
export function scoreTransferFeatures(amountMinor: bigint, f: TransferFeatures): FraudDecision {
  const reasons: Reason[] = [];
  let score = 0;

  // Velocity — many transfers in a short window is the classic burst-out signal.
  if (f.velocity >= 10) {
    score += 0.7;
    reasons.push({ code: "velocity_burst", weight: 0.7 });
  } else if (f.velocity >= 6) {
    score += 0.3;
    reasons.push({ code: "velocity_elevated", weight: 0.3 });
  }

  // First-time payee — mild on its own, compounds with the others.
  if (f.newPayee) {
    score += 0.15;
    reasons.push({ code: "new_payee", weight: 0.15 });
  }

  // Amount spike vs the user's own history (only meaningful once history exists).
  if (f.trailingMaxMinor > 0n && amountMinor > 0n) {
    if (amountMinor >= f.trailingMaxMinor * 10n && amountMinor >= 200_000n) {
      score += 0.6;
      reasons.push({ code: "amount_spike_10x", weight: 0.6 });
    } else if (amountMinor >= f.trailingMaxMinor * 5n && amountMinor >= 100_000n) {
      score += 0.35;
      reasons.push({ code: "amount_spike_5x", weight: 0.35 });
    }
  }

  // Large absolute single transfer (>= $9,000) — flag-grade on its own.
  if (amountMinor >= 900_000n) {
    score += 0.3;
    reasons.push({ code: "large_absolute", weight: 0.3 });
  }

  score = Math.min(1, score);

  let action: FraudAction;
  if (score >= BLOCK_AT) action = "block";
  else if (score >= CHALLENGE_AT) action = "challenge";
  else if (score >= FLAG_AT) action = "flag";
  else action = "allow";

  return { action, score, reasons, modelVersion: FRAUD_MODEL_VERSION };
}

async function recordDecision(
  ev: TransferRiskEvent,
  decision: FraudDecision,
  enforced: boolean
): Promise<void> {
  const db = getDb();
  await db.execute(
    `INSERT INTO fraud_decisions
       (id, event_id, event_type, channel, user_id, counterparty_id, amount_minor, currency,
        score, action, reasons, model_version, enforced, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      uuidv4(), // event_id — future: the stream key/offset
      ev.eventType,
      ev.channel,
      ev.userId,
      ev.counterpartyId,
      ev.amountMinor,
      ev.currency,
      Math.round(decision.score * 1000),
      decision.action,
      JSON.stringify(decision.reasons),
      decision.modelVersion,
      enforced ? 1 : 0,
      ev.idempotencyKey ?? null,
      new Date().toISOString(),
    ]
  );

  fraudDecisionTotal.inc({ event_type: ev.eventType, action: decision.action });

  // Mirror into the human-facing audit trail; a block is a 'blocked' audit event.
  await logAudit({
    userId: ev.userId,
    action: "fraud_decision",
    resource: ev.idempotencyKey ?? ev.counterpartyId,
    status: decision.action === "block" ? "blocked" : "success",
    details: {
      eventType: ev.eventType,
      channel: ev.channel,
      action: decision.action,
      score: decision.score,
      reasons: decision.reasons.map((r) => r.code),
      modelVersion: decision.modelVersion,
      enforced,
    },
  });
}

/**
 * Merge the local (rules-v0) and remote (fraud-engine) opinions. Both are
 * advisory; the effective action is the MORE severe of the two, so the engine
 * can only raise scrutiny. The remote model version is recorded so a decision is
 * traceable to whatever scored it.
 */
function mergeDecision(local: FraudDecision, remote: RemoteDecision): FraudDecision {
  const remoteAction = clampSync(remote.action);
  const action = (SEVERITY[remoteAction] ?? 0) > (SEVERITY[local.action] ?? 0) ? remoteAction : local.action;
  return {
    action,
    score: Math.max(local.score, remote.score),
    reasons: [...local.reasons, ...remote.reasons.map((r) => ({ code: `remote:${r.code}`, weight: r.weight }))],
    modelVersion: `${local.modelVersion}+${remote.modelVersion}`,
  };
}

/**
 * Screen a transfer before settlement. The in-Argus triage (the local rules-v0
 * scorer) classifies the event:
 *   - non-benign (any elevated signal) → screened SYNCHRONOUSLY against the
 *     standalone fraud engine; the merged action gates settlement (blocking path).
 *   - benign                           → emitted FIRE-AND-FORGET so the engine
 *     still ingests/scores it (and may later call back to freeze) without adding
 *     latency to the money path.
 *
 * Throws FRAUD_BLOCKED only when the effective action is `block` AND enforcement
 * is on (otherwise shadow mode — recorded, not acted on). The remote score is
 * ADVISORY; this deterministic gate is the only thing that blocks money here.
 *
 * Callers must only screen FUNDED transfers (skip on insufficient funds) so an
 * unfunded attempt fails as INSUFFICIENT_FUNDS, not as fraud.
 */
export async function screenTransfer(ev: TransferRiskEvent): Promise<FraudDecision> {
  if (!config.FRAUD_ENGINE_ENABLED) {
    return { action: "allow", score: 0, reasons: [], modelVersion: FRAUD_MODEL_VERSION };
  }

  // 1) Local deterministic scorer — both the enforcement floor and the triage classifier.
  const features = await gatherFeatures(ev, getDb());
  const local = scoreTransferFeatures(ev.amountMinor, features);

  // 2) Triage → blocking (sync) vs fire-and-forget (async) call to the engine.
  const client = getFraudClient();
  const remoteEvent = {
    eventType: ev.eventType,
    channel: ev.channel,
    userId: ev.userId,
    counterpartyId: ev.counterpartyId,
    amountMinor: ev.amountMinor,
    currency: ev.currency,
    idempotencyKey: ev.idempotencyKey,
  };

  let effective: FraudDecision = local;
  if (local.action !== "allow") {
    const remote = await client.scoreSync(remoteEvent);
    if (remote) effective = mergeDecision(local, remote);
  } else {
    await client.emitAsync(remoteEvent);
  }

  // 3) Deterministic gate on the effective (merged) action.
  const willEnforce = effective.action === "block" && config.FRAUD_ENGINE_ENFORCE;
  await recordDecision(ev, effective, willEnforce);

  if (willEnforce) {
    throw new AppError(
      ErrorCode.FRAUD_BLOCKED,
      "This transfer was blocked by fraud screening. Contact support if you believe this is an error."
    );
  }

  return effective;
}

export interface FraudDecisionRow {
  id: string;
  eventType: string;
  channel: string | null;
  counterpartyId: string | null;
  amountMinor: string | null;
  currency: string | null;
  score: number;
  action: string;
  reasons: Reason[];
  modelVersion: string;
  enforced: boolean;
  createdAt: string;
}

export async function getFraudDecisions(userId: string, limit = 50): Promise<FraudDecisionRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<{
    id: string;
    event_type: string;
    channel: string | null;
    counterparty_id: string | null;
    amount_minor: string | number | null;
    currency: string | null;
    score: number;
    action: string;
    reasons: string;
    model_version: string;
    enforced: number;
    created_at: string;
  }>(
    `SELECT id, event_type, channel, counterparty_id, amount_minor, currency, score,
            action, reasons, model_version, enforced, created_at
       FROM fraud_decisions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, capped]
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    channel: r.channel,
    counterpartyId: r.counterparty_id,
    amountMinor: r.amount_minor == null ? null : BigInt(r.amount_minor).toString(),
    currency: r.currency,
    score: Number(r.score),
    action: r.action,
    reasons: JSON.parse(r.reasons) as Reason[],
    modelVersion: r.model_version,
    enforced: Number(r.enforced) === 1,
    createdAt: r.created_at,
  }));
}
