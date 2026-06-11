/**
 * Escrow & dispute layer — the chargeback substitute for irreversible settlement.
 *
 * Generalizes the Phase-8 marketplace escrow (subscribe→close/refund) into an
 * arbitrary payer→payee held payment with a dispute state
 * (docs/business/PAYMENT-NETWORK-STRATEGY.md §4):
 *
 *   hold      payer_cash → escrow        (funds held)
 *   release   escrow → payee_cash        (happy path: goods delivered)
 *   refund    escrow → payer_cash        (cancel/return)
 *   dispute   (no money move; funds stay in escrow)
 *   resolve   escrow → payee | payer     (mediated outcome)
 *
 * Every money move is a balanced, idempotent ledger journal through the existing
 * `escrow` system account (ledgerService). escrow_payments holds the mutable state;
 * escrow_events is the append-only transition log. The ledger stays the source of
 * truth — this service never mutates balances directly.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, type Db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getOrCreateUserAccount, getSystemAccount, getBalance, postJournal } from "./ledgerService";

export type EscrowStatus = "held" | "disputed" | "released" | "refunded";
export type Resolution = "release" | "refund";

const SUPPORTED_CURRENCIES = new Set(["USD", "USDC"]);

export interface EscrowRow {
  id: string;
  payerId: string;
  payeeId: string;
  payerEmail?: string;
  payeeEmail?: string;
  amountMinor: string;
  currency: string;
  status: EscrowStatus;
  memo: string | null;
  disputeReason: string | null;
  resolution: Resolution | null;
  createdAt: string;
}

interface RawEscrow {
  id: string;
  payer_id: string;
  payee_id: string;
  payer_email?: string;
  payee_email?: string;
  amount_minor: string | number;
  currency: string;
  status: EscrowStatus;
  memo: string | null;
  hold_journal_id: string | null;
  settle_journal_id: string | null;
  dispute_reason: string | null;
  resolution: Resolution | null;
  idempotency_key: string | null;
  created_at: string;
}

function mapEscrow(r: RawEscrow): EscrowRow {
  return {
    id: r.id,
    payerId: r.payer_id,
    payeeId: r.payee_id,
    payerEmail: r.payer_email,
    payeeEmail: r.payee_email,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    status: r.status,
    memo: r.memo,
    disputeReason: r.dispute_reason,
    resolution: r.resolution,
    createdAt: r.created_at,
  };
}

// Read with counterparty emails joined (for the app/admin surfaces).
const ESCROW_SELECT = `SELECT e.*, pp.email AS payer_email, pe.email AS payee_email
  FROM escrow_payments e JOIN users pp ON pp.id = e.payer_id JOIN users pe ON pe.id = e.payee_id`;

async function recordEvent(
  tx: Db,
  escrowId: string,
  event: string,
  actor: string,
  detail: Record<string, unknown>,
  journalId: string | null
): Promise<void> {
  await tx.execute(
    "INSERT INTO escrow_events (id, escrow_id, event, actor, detail, journal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [uuidv4(), escrowId, event, actor, JSON.stringify(detail), journalId, new Date().toISOString()]
  );
}

/** Hold a payment from payer to payee. Idempotent on idempotencyKey. */
export async function hold(input: {
  payerId: string;
  payeeId: string;
  amountMinor: bigint;
  currency: string;
  memo?: string;
  idempotencyKey: string;
}): Promise<EscrowRow> {
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Escrow amount must be positive");
  if (!SUPPORTED_CURRENCIES.has(input.currency)) throw new AppError(ErrorCode.VALIDATION, "Unsupported currency");
  if (input.payerId === input.payeeId) throw new AppError(ErrorCode.VALIDATION, "Payer and payee must differ");

  const db = getDb();
  const existing = await db.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (existing) return mapEscrow(existing);

  const payee = await db.queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [input.payeeId]);
  if (!payee) throw new AppError(ErrorCode.NOT_FOUND, "Payee not found");

  const id = uuidv4();
  return db.transaction(async (tx) => {
    const payerCash = await getOrCreateUserAccount(input.payerId, "user_cash", input.currency, tx);
    const escrowId = await getSystemAccount("escrow", input.currency, tx);

    const bal = await getBalance(payerCash, tx);
    if (bal < input.amountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds to hold");

    const holdJournal = await postJournal(
      [
        { ledgerAccountId: payerCash, direction: "debit", amountMinor: input.amountMinor, currency: input.currency },
        { ledgerAccountId: escrowId, direction: "credit", amountMinor: input.amountMinor, currency: input.currency },
      ],
      `Escrow hold ${input.payerId}→${input.payeeId}`,
      { idempotencyKey: `escrow:hold:${input.idempotencyKey}`, db: tx }
    );

    const now = new Date().toISOString();
    await tx.execute(
      `INSERT INTO escrow_payments (id, payer_id, payee_id, amount_minor, currency, status, memo, hold_journal_id, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?, ?, ?)`,
      [id, input.payerId, input.payeeId, input.amountMinor, input.currency, input.memo ?? null, holdJournal, input.idempotencyKey, now, now]
    );
    await recordEvent(tx, id, "held", input.payerId, { amountMinor: input.amountMinor.toString(), currency: input.currency }, holdJournal);
    await logAudit({ userId: input.payerId, action: "escrow.hold", resource: id, details: { payeeId: input.payeeId, amountMinor: input.amountMinor.toString(), currency: input.currency } });

    const row = await tx.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE id = ?", [id]);
    return mapEscrow(row!);
  });
}

/**
 * Move the held funds out of escrow and set the terminal status. Shared by
 * release / refund / resolveDispute. Idempotent: re-running a settled escrow into
 * the same outcome is a no-op; an incompatible transition throws CONFLICT.
 */
async function settle(
  escrowId: string,
  outcome: Resolution,
  opts: { fromStatuses: EscrowStatus[]; actor: string; resolution?: boolean }
): Promise<EscrowRow> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const e = await tx.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE id = ?", [escrowId]);
    if (!e) throw new AppError(ErrorCode.NOT_FOUND, "Escrow not found");

    const terminal: EscrowStatus = outcome === "release" ? "released" : "refunded";
    if (e.status === terminal) return mapEscrow(e); // idempotent no-op
    if (!opts.fromStatuses.includes(e.status)) {
      throw new AppError(ErrorCode.CONFLICT, `Cannot ${outcome} an escrow in status '${e.status}'`);
    }

    const currency = e.currency;
    const amount = BigInt(e.amount_minor);
    const escrowAcct = await getSystemAccount("escrow", currency, tx);
    const recipientId = outcome === "release" ? e.payee_id : e.payer_id;
    const recipientCash = await getOrCreateUserAccount(recipientId, "user_cash", currency, tx);

    const journalId = await postJournal(
      [
        { ledgerAccountId: escrowAcct, direction: "debit", amountMinor: amount, currency },
        { ledgerAccountId: recipientCash, direction: "credit", amountMinor: amount, currency },
      ],
      `Escrow ${terminal} ${escrowId}`,
      { idempotencyKey: `escrow:settle:${escrowId}`, db: tx }
    );

    await tx.execute(
      "UPDATE escrow_payments SET status = ?, settle_journal_id = ?, resolution = ?, updated_at = ? WHERE id = ?",
      [terminal, journalId, opts.resolution ? outcome : null, new Date().toISOString(), escrowId]
    );
    await recordEvent(tx, escrowId, opts.resolution ? "dispute_resolved" : terminal, opts.actor, { outcome, amountMinor: amount.toString() }, journalId);
    await logAudit({ userId: recipientId, action: `escrow.${opts.resolution ? "resolve" : terminal}`, resource: escrowId, details: { outcome } });

    const row = await tx.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE id = ?", [escrowId]);
    return mapEscrow(row!);
  });
}

/** Release held funds to the payee (happy path). From held or disputed. */
export async function release(escrowId: string, actor = "system"): Promise<EscrowRow> {
  return settle(escrowId, "release", { fromStatuses: ["held"], actor });
}

/** Refund held funds to the payer (cancel/return). From held. */
export async function refund(escrowId: string, actor = "system"): Promise<EscrowRow> {
  return settle(escrowId, "refund", { fromStatuses: ["held"], actor });
}

/** Open a dispute — funds stay held; only a 'held' escrow can be disputed. */
export async function openDispute(escrowId: string, reason: string, actor: string): Promise<EscrowRow> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const e = await tx.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE id = ?", [escrowId]);
    if (!e) throw new AppError(ErrorCode.NOT_FOUND, "Escrow not found");
    if (e.status === "disputed") return mapEscrow(e); // idempotent
    if (e.status !== "held") throw new AppError(ErrorCode.CONFLICT, `Cannot dispute an escrow in status '${e.status}'`);

    await tx.execute("UPDATE escrow_payments SET status = 'disputed', dispute_reason = ?, updated_at = ? WHERE id = ?", [reason, new Date().toISOString(), escrowId]);
    await recordEvent(tx, escrowId, "disputed", actor, { reason }, null);
    await logAudit({ userId: actor, action: "escrow.dispute", resource: escrowId, details: { reason } });

    const row = await tx.queryOne<RawEscrow>("SELECT * FROM escrow_payments WHERE id = ?", [escrowId]);
    return mapEscrow(row!);
  });
}

/** Mediator resolution of a dispute → release to payee or refund to payer. */
export async function resolveDispute(escrowId: string, outcome: Resolution, actor = "mediator"): Promise<EscrowRow> {
  return settle(escrowId, outcome, { fromStatuses: ["disputed"], actor, resolution: true });
}

export async function getEscrow(escrowId: string): Promise<EscrowRow | null> {
  const row = await getDb().queryOne<RawEscrow>(`${ESCROW_SELECT} WHERE e.id = ?`, [escrowId]);
  return row ? mapEscrow(row) : null;
}

/** Escrows where the user is payer or payee. */
export async function listEscrows(userId: string, limit = 50): Promise<EscrowRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<RawEscrow>(
    `${ESCROW_SELECT} WHERE e.payer_id = ? OR e.payee_id = ? ORDER BY e.created_at DESC LIMIT ?`,
    [userId, userId, capped]
  );
  return rows.map(mapEscrow);
}

/** Open disputes — the mediator (compliance/admin) work queue. */
export async function listDisputed(limit = 100): Promise<EscrowRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<RawEscrow>(
    `${ESCROW_SELECT} WHERE e.status = 'disputed' ORDER BY e.created_at ASC LIMIT ?`,
    [capped]
  );
  return rows.map(mapEscrow);
}
