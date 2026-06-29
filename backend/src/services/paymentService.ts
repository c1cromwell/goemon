/**
 * Phase 21 Stage 1 — "Goeman Pay": the native stablecoin-settled payment rail
 * (docs/business/PAYMENT-NETWORK-STRATEGY.md §4/§8).
 *
 * Merchants (directly-integrated counterparties owned by an Goeman user) request
 * money with payment intents; the payer — or an authorized agent under the
 * pay:merchant MCP scope — pays them. There is NO interchange: the rail charges
 * zero fee (that is the wedge vs card networks).
 *
 * Every payment is ESCROW-PROTECTED (the chargeback substitute for irreversible
 * settlement): paying an intent holds funds via escrowService (payer_cash → escrow,
 * on-chain on the USDC/Hedera rail when enabled), and capture/refund/dispute ride
 * the same balanced, idempotent ledger journals. Once paid, the intent's effective
 * status DERIVES from its escrow row — one state machine for money:
 *
 *   requires_payment → paid(held) → settled   (capture: escrow → merchant owner)
 *                                 → refunded  (refund: escrow → payer)
 *                                 → disputed  (funds stay held; mediated on the
 *                                              existing /api/admin/escrow surface)
 *   requires_payment → canceled | expired     (no money ever moved)
 *
 * Shed-ability (the SLA-isolation discipline from the Phase-17 seam): the
 * GOEMAN_PAY_ENABLED kill-switch gates NEW intents and payments only — capture,
 * refund, and dispute on already-held funds stay available so money is never
 * stranded, and transfers/the rest of the bank are wholly unaffected.
 *
 * Single-payment invariant: the escrow hold is idempotent on `pay:intent:<id>`,
 * so an intent can never be double-paid at the money layer regardless of payer
 * retries or races.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb, type Db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { assertSupported } from "./currencyRegistry";
import { payEventTotal } from "../observability/metrics";
import {
  hold,
  release,
  refund as escrowRefund,
  openDispute,
  type EscrowRow,
  type EscrowStatus,
} from "./escrowService";

const DEFAULT_INTENT_TTL_SECS = 15 * 60;
const MAX_INTENT_TTL_SECS = 24 * 60 * 60;
const MAX_INTENT_MINOR = 10_000_000n; // $100,000 / 10 USDC-million-micro per intent

export type IntentStatus =
  | "requires_payment"
  | "held"
  | "disputed"
  | "settled"
  | "refunded"
  | "canceled"
  | "expired";

export interface MerchantRow {
  id: string;
  ownerUserId: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
}

export interface PaymentIntentRow {
  id: string;
  merchantId: string;
  merchantName: string;
  amountMinor: string;
  currency: string;
  memo: string | null;
  status: IntentStatus;
  payerUserId: string | null;
  escrowId: string | null;
  authorizedVia: "user" | "agent" | "vp" | null;
  agentDid: string | null;
  expiresAt: string;
  createdAt: string;
}

interface RawMerchant {
  id: string;
  owner_user_id: string;
  name: string;
  status: "active" | "suspended";
  created_at: string;
}

interface RawIntent {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_owner_id: string;
  amount_minor: string | number;
  currency: string;
  memo: string | null;
  status: string;
  payer_user_id: string | null;
  escrow_id: string | null;
  escrow_status: EscrowStatus | null;
  authorized_via: "user" | "agent" | "vp" | null;
  agent_did: string | null;
  token_jti: string | null;
  idempotency_key: string | null;
  expires_at: string;
  created_at: string;
}

function assertPayEnabled(): void {
  if (!config.GOEMAN_PAY_ENABLED) {
    throw new AppError(ErrorCode.PAY_DISABLED, "Goeman Pay is currently unavailable");
  }
}

/** Effective status: once paid, the protecting escrow is the state machine. */
function effectiveStatus(r: RawIntent): IntentStatus {
  if (r.status === "paid" && r.escrow_status) {
    switch (r.escrow_status) {
      case "held":
        return "held";
      case "disputed":
        return "disputed";
      case "released":
        return "settled";
      case "refunded":
        return "refunded";
    }
  }
  return r.status as IntentStatus;
}

function mapIntent(r: RawIntent): PaymentIntentRow {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    memo: r.memo,
    status: effectiveStatus(r),
    payerUserId: r.payer_user_id,
    escrowId: r.escrow_id,
    authorizedVia: r.authorized_via,
    agentDid: r.agent_did,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

const INTENT_SELECT = `SELECT i.*, m.name AS merchant_name, m.owner_user_id AS merchant_owner_id, e.status AS escrow_status
  FROM payment_intents i
  JOIN merchants m ON m.id = i.merchant_id
  LEFT JOIN escrow_payments e ON e.id = i.escrow_id`;

async function recordEvent(
  db: Db,
  intentId: string,
  event: string,
  actor: string,
  detail: Record<string, unknown>
): Promise<void> {
  await db.execute(
    "INSERT INTO payment_events (id, intent_id, event, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [uuidv4(), intentId, event, actor, JSON.stringify(detail), new Date().toISOString()]
  );
  payEventTotal.inc({ event });
}

// ---------------------------------------------------------------------------
// Merchants (the acceptance side)
// ---------------------------------------------------------------------------

export async function createMerchant(ownerUserId: string, name: string): Promise<MerchantRow> {
  assertPayEnabled();
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(ErrorCode.VALIDATION, "Merchant name required");
  const db = getDb();
  const id = uuidv4();
  await db.execute(
    "INSERT INTO merchants (id, owner_user_id, name, status, created_at) VALUES (?, ?, ?, 'active', ?)",
    [id, ownerUserId, trimmed, new Date().toISOString()]
  );
  await logAudit({ userId: ownerUserId, action: "pay.merchant.create", resource: id, details: { name: trimmed } });
  return (await getMerchant(id))!;
}

export async function getMerchant(merchantId: string): Promise<MerchantRow | null> {
  const r = await getDb().queryOne<RawMerchant>("SELECT * FROM merchants WHERE id = ?", [merchantId]);
  return r ? { id: r.id, ownerUserId: r.owner_user_id, name: r.name, status: r.status, createdAt: r.created_at } : null;
}

export async function listMerchants(ownerUserId: string): Promise<MerchantRow[]> {
  const rows = await getDb().query<RawMerchant>(
    "SELECT * FROM merchants WHERE owner_user_id = ? ORDER BY created_at DESC",
    [ownerUserId]
  );
  return rows.map((r) => ({ id: r.id, ownerUserId: r.owner_user_id, name: r.name, status: r.status, createdAt: r.created_at }));
}

// ---------------------------------------------------------------------------
// Payment intents
// ---------------------------------------------------------------------------

export async function createPaymentIntent(input: {
  merchantId: string;
  actorUserId: string; // must own the merchant
  amountMinor: bigint;
  currency: string;
  memo?: string;
  ttlSecs?: number;
  idempotencyKey: string;
}): Promise<PaymentIntentRow> {
  assertPayEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (input.amountMinor > MAX_INTENT_MINOR) throw new AppError(ErrorCode.VALIDATION, `Amount exceeds maximum of ${MAX_INTENT_MINOR}`);
  assertSupported(input.currency);
  const ttl = input.ttlSecs ?? DEFAULT_INTENT_TTL_SECS;
  if (ttl <= 0 || ttl > MAX_INTENT_TTL_SECS) throw new AppError(ErrorCode.VALIDATION, "ttlSecs out of range");

  const db = getDb();
  const existing = await db.queryOne<RawIntent>(`${INTENT_SELECT} WHERE i.idempotency_key = ?`, [input.idempotencyKey]);
  if (existing) return mapIntent(existing);

  const merchant = await getMerchant(input.merchantId);
  if (!merchant) throw new AppError(ErrorCode.NOT_FOUND, "Merchant not found");
  if (merchant.ownerUserId !== input.actorUserId) throw new AppError(ErrorCode.FORBIDDEN, "Not your merchant");
  if (merchant.status !== "active") throw new AppError(ErrorCode.CONFLICT, "Merchant is suspended");

  const id = uuidv4();
  const now = new Date();
  await db.execute(
    `INSERT INTO payment_intents (id, merchant_id, amount_minor, currency, memo, status, idempotency_key, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'requires_payment', ?, ?, ?, ?)`,
    [
      id,
      merchant.id,
      input.amountMinor,
      input.currency,
      input.memo ?? null,
      input.idempotencyKey,
      new Date(now.getTime() + ttl * 1000).toISOString(),
      now.toISOString(),
      now.toISOString(),
    ]
  );
  await recordEvent(db, id, "created", input.actorUserId, {
    amountMinor: input.amountMinor.toString(),
    currency: input.currency,
  });
  return (await getIntent(id))!;
}

export async function getIntent(intentId: string): Promise<PaymentIntentRow | null> {
  const r = await getDb().queryOne<RawIntent>(`${INTENT_SELECT} WHERE i.id = ?`, [intentId]);
  return r ? mapIntent(r) : null;
}

async function getRawIntent(intentId: string): Promise<RawIntent> {
  const r = await getDb().queryOne<RawIntent>(`${INTENT_SELECT} WHERE i.id = ?`, [intentId]);
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "Payment intent not found");
  return r;
}

/** Intents where the user is the merchant owner or the payer. */
export async function listIntents(userId: string, role: "merchant" | "payer", limit = 50): Promise<PaymentIntentRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const where = role === "merchant" ? "m.owner_user_id = ?" : "i.payer_user_id = ?";
  const rows = await getDb().query<RawIntent>(`${INTENT_SELECT} WHERE ${where} ORDER BY i.created_at DESC LIMIT ?`, [
    userId,
    capped,
  ]);
  return rows.map(mapIntent);
}

/**
 * Pay an intent: escrow-hold payer → merchant owner (on-chain on the USDC/Hedera
 * rail when enabled). The hold is idempotent on `pay:intent:<id>`, so the intent
 * can only ever be paid once at the money layer; a racing second payer loses the
 * claim with CONFLICT and never moves funds.
 */
export async function payIntent(input: {
  intentId: string;
  payerUserId: string;
  authorizedVia: "user" | "agent" | "vp";
  agentDid?: string;
  tokenJti?: string;
}): Promise<PaymentIntentRow> {
  assertPayEnabled();
  // A frozen payer cannot pay (fraud remediation gate — same as transfers).
  if (await isAccountFrozen(input.payerUserId)) {
    throw new AppError(ErrorCode.ACCOUNT_FROZEN, "This account is temporarily frozen pending a fraud review. Contact support.");
  }
  const db = getDb();
  const raw = await getRawIntent(input.intentId);
  const status = effectiveStatus(raw);

  // Idempotent re-pay by the same payer; anything else paid/terminal is a conflict.
  if (status !== "requires_payment") {
    if (raw.payer_user_id === input.payerUserId && raw.status === "paid") return mapIntent(raw);
    throw new AppError(ErrorCode.CONFLICT, `Intent is ${status}, not payable`);
  }
  if (raw.merchant_owner_id === input.payerUserId) {
    throw new AppError(ErrorCode.VALIDATION, "Cannot pay your own merchant");
  }
  const merchant = await getMerchant(raw.merchant_id);
  if (!merchant || merchant.status !== "active") throw new AppError(ErrorCode.CONFLICT, "Merchant is suspended");

  if (new Date(raw.expires_at).getTime() < Date.now()) {
    await db.execute("UPDATE payment_intents SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'requires_payment'", [
      new Date().toISOString(),
      raw.id,
    ]);
    await recordEvent(db, raw.id, "expired", "system", {});
    throw new AppError(ErrorCode.CONFLICT, "Payment intent has expired");
  }

  // The money move — idempotent per intent; on the USDC rail this also settles
  // payer → escrow custodian on Hedera (escrowService owns that leg).
  const escrow: EscrowRow = await hold({
    payerId: input.payerUserId,
    payeeId: raw.merchant_owner_id,
    amountMinor: BigInt(raw.amount_minor),
    currency: raw.currency,
    memo: `Goeman Pay: ${raw.merchant_name} (${raw.id})`,
    idempotencyKey: `pay:intent:${raw.id}`,
  });
  // A racing payer may have created the hold first — only that payer holds the claim.
  if (escrow.payerId !== input.payerUserId) {
    throw new AppError(ErrorCode.CONFLICT, "Intent was already paid by another payer");
  }

  await db.execute(
    `UPDATE payment_intents SET status = 'paid', payer_user_id = ?, escrow_id = ?, authorized_via = ?, agent_did = ?, token_jti = ?, updated_at = ?
     WHERE id = ? AND status = 'requires_payment'`,
    [
      input.payerUserId,
      escrow.id,
      input.authorizedVia,
      input.agentDid ?? null,
      input.tokenJti ?? null,
      new Date().toISOString(),
      raw.id,
    ]
  );
  await recordEvent(db, raw.id, "paid", input.agentDid ?? input.payerUserId, {
    escrowId: escrow.id,
    authorizedVia: input.authorizedVia,
  });
  await logAudit({
    userId: input.payerUserId,
    action: "pay.intent.pay",
    resource: raw.id,
    details: { merchantId: raw.merchant_id, amountMinor: BigInt(raw.amount_minor).toString(), currency: raw.currency, authorizedVia: input.authorizedVia, agentDid: input.agentDid ?? null },
  });
  return (await getIntent(raw.id))!;
}

/** Require the actor to be a specific party; returns the raw row. */
async function requireHeldIntent(intentId: string): Promise<RawIntent> {
  const raw = await getRawIntent(intentId);
  if (!raw.escrow_id) throw new AppError(ErrorCode.CONFLICT, "Intent has not been paid");
  return raw;
}

/** Merchant captures the held funds (escrow → merchant owner). Idempotent. */
export async function captureIntent(intentId: string, actorUserId: string): Promise<PaymentIntentRow> {
  const raw = await requireHeldIntent(intentId);
  if (raw.merchant_owner_id !== actorUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the merchant can capture");
  await release(raw.escrow_id!, actorUserId);
  await recordEvent(getDb(), raw.id, "captured", actorUserId, { escrowId: raw.escrow_id });
  return (await getIntent(raw.id))!;
}

/** Merchant refunds the held funds (escrow → payer). Idempotent. */
export async function refundIntent(intentId: string, actorUserId: string): Promise<PaymentIntentRow> {
  const raw = await requireHeldIntent(intentId);
  if (raw.merchant_owner_id !== actorUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the merchant can refund");
  await escrowRefund(raw.escrow_id!, actorUserId);
  await recordEvent(getDb(), raw.id, "refunded", actorUserId, { escrowId: raw.escrow_id });
  return (await getIntent(raw.id))!;
}

/** Payer disputes — funds stay held; mediation is the /api/admin/escrow surface. */
export async function disputeIntent(intentId: string, actorUserId: string, reason: string): Promise<PaymentIntentRow> {
  const raw = await requireHeldIntent(intentId);
  if (raw.payer_user_id !== actorUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the payer can dispute");
  await openDispute(raw.escrow_id!, reason, actorUserId);
  await recordEvent(getDb(), raw.id, "disputed", actorUserId, { reason });
  return (await getIntent(raw.id))!;
}

/** Merchant cancels an unpaid intent. No money ever moved. */
export async function cancelIntent(intentId: string, actorUserId: string): Promise<PaymentIntentRow> {
  const raw = await getRawIntent(intentId);
  if (raw.merchant_owner_id !== actorUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the merchant can cancel");
  const status = effectiveStatus(raw);
  if (status === "canceled") return mapIntent(raw); // idempotent
  if (status !== "requires_payment" && status !== "expired") {
    throw new AppError(ErrorCode.CONFLICT, `Cannot cancel an intent that is ${status}`);
  }
  await getDb().execute("UPDATE payment_intents SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('requires_payment','expired')", [
    new Date().toISOString(),
    raw.id,
  ]);
  await recordEvent(getDb(), raw.id, "canceled", actorUserId, {});
  return (await getIntent(raw.id))!;
}
