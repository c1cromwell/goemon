/**
 * Phase 19.3 — bill pay (prototype seam).
 *
 * A bill payment is a directed payout to a saved payee (biller). It rides the same
 * partner-bank rail as withdrawals (getBankRailProvider().initiatePayout) and settles via
 * the ledger's external_clearing:
 *   send: user_cash → external_clearing   (money leaves to the biller)
 *
 * Payments may be immediate (scheduled_for <= now) or scheduled for later; a recurring
 * payment seeds its next instance on send. Every send is a balanced, idempotent,
 * append-only journal under the account-freeze + balance + fraud (bill.pay) gates.
 * Off by default behind BILLPAY_ENABLED (prod-fatal).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { screenTransfer } from "./fraudService";
import { billPaymentTotal } from "../observability/metrics";
import { getBalance, getOrCreateUserAccount, getSystemAccount, postJournal } from "./ledgerService";
import { getBankRailProvider } from "./bankRailService";

export type Recurrence = "none" | "weekly" | "monthly";

function assertEnabled(): void {
  if (!config.BILLPAY_ENABLED) throw new AppError(ErrorCode.BILLPAY_DISABLED, "Bill pay is currently unavailable");
}

export interface BillPayeeRow {
  id: string; user_id: string; name: string; category: string | null; masked_account: string | null; status: string; created_at: string;
}
export interface BillPaymentRow {
  id: string; user_id: string; payee_id: string; amount_minor: string; currency: string; status: string;
  recurrence: string; scheduled_for: string; journal_id: string | null; external_ref: string | null;
  idempotency_key: string | null; created_at: string; sent_at: string | null;
}

export async function addPayee(input: { userId: string; name: string; category?: string; last4?: string }): Promise<BillPayeeRow> {
  assertEnabled();
  if (!input.name?.trim()) throw new AppError(ErrorCode.VALIDATION, "Payee name required");
  if (input.last4 && !/^\d{4}$/.test(input.last4)) throw new AppError(ErrorCode.VALIDATION, "last4 must be 4 digits");
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO bill_payees (id, user_id, name, category, masked_account, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [id, input.userId, input.name.trim(), input.category ?? null, input.last4 ? `••••${input.last4}` : null, new Date().toISOString()]
  );
  return (await getDb().queryOne<BillPayeeRow>("SELECT * FROM bill_payees WHERE id = ?", [id]))!;
}

export async function listPayees(userId: string): Promise<BillPayeeRow[]> {
  return getDb().query<BillPayeeRow>("SELECT * FROM bill_payees WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC", [userId]);
}

function nextDate(fromISO: string, recurrence: Recurrence): string | null {
  if (recurrence === "none") return null;
  const d = new Date(fromISO);
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

/** Settle a scheduled payment (post the journal). Used by payBill (immediate) + the due-loop. */
async function send(payment: BillPaymentRow, channel = "billpay"): Promise<void> {
  const amount = BigInt(payment.amount_minor);
  if (await isAccountFrozen(payment.user_id)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const cash = await getOrCreateUserAccount(payment.user_id, "user_cash", payment.currency);
  const clearing = await getSystemAccount("external_clearing", payment.currency);

  await screenTransfer({
    eventType: "bill.pay", channel, userId: payment.user_id, counterpartyId: payment.payee_id,
    fromAccountId: cash, toAccountId: clearing, amountMinor: amount, currency: payment.currency, idempotencyKey: payment.id,
  });

  const db = getDb();
  await db.transaction(async (tx) => {
    const balance = await getBalance(cash, tx);
    if (balance < amount) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");

    const ext = await getBankRailProvider().initiatePayout({ userId: payment.user_id, amountMinor: amount, currency: payment.currency, method: "ach", destination: payment.payee_id });
    const journalId = await postJournal(
      [
        { ledgerAccountId: cash, direction: "debit", amountMinor: amount, currency: payment.currency },
        { ledgerAccountId: clearing, direction: "credit", amountMinor: amount, currency: payment.currency },
      ],
      `Bill pay (${payment.id})`,
      { idempotencyKey: `billpay:${payment.id}`, externalRef: ext.externalRef, db: tx }
    );
    await tx.execute(
      `INSERT INTO transactions (id, user_id, journal_id, from_account_id, to_account_id, to_external, amount_minor, currency, description, type, status, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'Bill payment', 'bill_pay', 'completed', ?)`,
      [uuidv4(), payment.user_id, journalId, cash, payment.payee_id, amount.toString(), payment.currency, new Date().toISOString()]
    );
    await tx.execute("UPDATE bill_payments SET status = 'sent', journal_id = ?, external_ref = ?, sent_at = ? WHERE id = ?",
      [journalId, ext.externalRef, new Date().toISOString(), payment.id]);
  });

  // Recurring: seed the next instance.
  const next = nextDate(payment.scheduled_for, payment.recurrence as Recurrence);
  if (next) {
    await db.execute(
      `INSERT INTO bill_payments (id, user_id, payee_id, amount_minor, currency, status, recurrence, scheduled_for, created_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      [uuidv4(), payment.user_id, payment.payee_id, payment.amount_minor, payment.currency, payment.recurrence, next, new Date().toISOString()]
    );
  }

  billPaymentTotal.inc({ result: "sent" });
  await logAudit({ userId: payment.user_id, action: "billpay.sent", resource: payment.id, details: { amountMinor: payment.amount_minor, payeeId: payment.payee_id } });
}

export interface PayBillResult { paymentId: string; status: string }

/** Pay a bill now (scheduled_for omitted/past) or schedule it for later. Idempotent. */
export async function payBill(input: {
  userId: string; payeeId: string; amountMinor: bigint; currency?: string; recurrence?: Recurrence; scheduledFor?: string; idempotencyKey: string;
}): Promise<PayBillResult> {
  assertEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  const currency = input.currency ?? "USD";

  const prior = await getDb().queryOne<BillPaymentRow>("SELECT * FROM bill_payments WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return { paymentId: prior.id, status: prior.status };

  const payee = await getDb().queryOne<BillPayeeRow>("SELECT * FROM bill_payees WHERE id = ? AND user_id = ? AND status = 'active'", [input.payeeId, input.userId]);
  if (!payee) throw new AppError(ErrorCode.NOT_FOUND, "Payee not found");

  const scheduledFor = input.scheduledFor ?? new Date().toISOString();
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO bill_payments (id, user_id, payee_id, amount_minor, currency, status, recurrence, scheduled_for, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
    [id, input.userId, input.payeeId, input.amountMinor.toString(), currency, input.recurrence ?? "none", scheduledFor, input.idempotencyKey, new Date().toISOString()]
  );
  billPaymentTotal.inc({ result: "scheduled" });

  const row = (await getDb().queryOne<BillPaymentRow>("SELECT * FROM bill_payments WHERE id = ?", [id]))!;
  // Due now → send immediately; else leave scheduled for the due-loop.
  if (new Date(scheduledFor).getTime() <= Date.now()) {
    await send(row);
    return { paymentId: id, status: "sent" };
  }
  return { paymentId: id, status: "scheduled" };
}

/** Cancel a not-yet-sent payment. */
export async function cancelBill(userId: string, paymentId: string): Promise<{ canceled: boolean }> {
  assertEnabled();
  const p = await getDb().queryOne<BillPaymentRow>("SELECT * FROM bill_payments WHERE id = ? AND user_id = ?", [paymentId, userId]);
  if (!p) throw new AppError(ErrorCode.NOT_FOUND, "Payment not found");
  if (p.status !== "scheduled") throw new AppError(ErrorCode.CONFLICT, `Payment is ${p.status}`);
  await getDb().execute("UPDATE bill_payments SET status = 'canceled' WHERE id = ?", [paymentId]);
  billPaymentTotal.inc({ result: "canceled" });
  return { canceled: true };
}

/** Settle all scheduled payments now due. Returns the count sent (best-effort per payment). */
export async function processScheduledBills(nowISO = new Date().toISOString()): Promise<{ sent: number; failed: number }> {
  assertEnabled();
  const due = await getDb().query<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for ASC",
    [nowISO]
  );
  let sent = 0, failed = 0;
  for (const p of due) {
    try { await send(p); sent++; }
    catch (e) {
      failed++;
      billPaymentTotal.inc({ result: "failed" });
      await getDb().execute("UPDATE bill_payments SET status = 'failed' WHERE id = ?", [p.id]);
      await logAudit({ userId: p.user_id, action: "billpay.failed", resource: p.id, status: "failure", details: { err: (e as Error).message } });
    }
  }
  return { sent, failed };
}

export async function listPayments(userId: string, limit = 50): Promise<BillPaymentRow[]> {
  return getDb().query<BillPaymentRow>("SELECT * FROM bill_payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, Math.min(Math.max(limit, 1), 200)]);
}
