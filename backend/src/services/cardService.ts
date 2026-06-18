/**
 * Phase 19.4 — debit cards (prototype seam).
 *
 * A card spends the user's ledger cash through an auth→capture lifecycle, with held funds
 * parked in a `card_holds` system account so they're unspendable but on the books:
 *   authorize: user_cash → card_holds        (hold; balance + freeze + fraud gates)
 *   capture:   card_holds → external_clearing (settle — money leaves via the bank rail)
 *   void:      card_holds → user_cash         (release an uncaptured auth)
 *   refund:    external_clearing → user_cash  (after capture)
 * Every step is a balanced, idempotent, append-only ledger journal (integer minor units).
 *
 * The card processor is a swappable CardProcessor (simulated stand-in; marqeta/lithic/
 * stripe are the prod swaps), selected by CARD_PROCESSOR. Off by default behind
 * CARDS_ENABLED (prod-fatal). Only a masked PAN (last4) is stored — the processor holds
 * the real PAN/CVV (PCI scope stays with the processor).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { screenTransfer } from "./fraudService";
import { cardAuthTotal } from "../observability/metrics";
import { getBalance, getOrCreateUserAccount, getOrCreateSystemAccount, getSystemAccount, postJournal } from "./ledgerService";

export interface CardProcessor {
  name: string;
  issueCard(input: { userId: string; currency: string }): Promise<{ network: string; last4: string; expMonth: number; expYear: number; processorRef: string }>;
}

function assertEnabled(): void {
  if (!config.CARDS_ENABLED) throw new AppError(ErrorCode.CARDS_DISABLED, "Cards are currently unavailable");
}

function simulatedProcessor(): CardProcessor {
  return {
    name: "simulated",
    async issueCard() {
      const last4 = String(1000 + Math.floor(Math.random() * 9000));
      const now = new Date();
      return { network: "visa", last4, expMonth: now.getMonth() + 1, expYear: now.getFullYear() + 4, processorRef: `sim-card-${uuidv4().slice(0, 8)}` };
    },
  };
}

function notImplemented(name: string): CardProcessor {
  return {
    name,
    async issueCard(): Promise<never> {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `CARD_PROCESSOR=${name} is not wired in this prototype — integrate the card processor (issue + network auth webhooks)`);
    },
  };
}

let processor: CardProcessor | null = null;
export function setCardProcessor(p: CardProcessor | null): void { processor = p; }
export function getCardProcessor(): CardProcessor {
  if (processor) return processor;
  switch (config.CARD_PROCESSOR) {
    case "marqeta": return notImplemented("marqeta");
    case "lithic": return notImplemented("lithic");
    case "stripe": return notImplemented("stripe");
    default: return simulatedProcessor();
  }
}

export interface CardRow {
  id: string; user_id: string; network: string; masked_number: string; exp_month: number; exp_year: number; currency: string; processor_ref: string | null; status: string; created_at: string;
}
export interface CardAuthRow {
  id: string; card_id: string; user_id: string; merchant: string | null; amount_minor: string; currency: string; status: string;
  hold_journal_id: string | null; settle_journal_id: string | null; idempotency_key: string | null; created_at: string; updated_at: string | null;
}

export async function issueCard(userId: string, currency = "USD"): Promise<CardRow> {
  assertEnabled();
  const c = await getCardProcessor().issueCard({ userId, currency });
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO cards (id, user_id, network, masked_number, exp_month, exp_year, currency, processor_ref, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, userId, c.network, `••••${c.last4}`, c.expMonth, c.expYear, currency, c.processorRef, new Date().toISOString()]
  );
  await logAudit({ userId, action: "card.issued", resource: id, details: { network: c.network } });
  return (await getDb().queryOne<CardRow>("SELECT * FROM cards WHERE id = ?", [id]))!;
}

export async function listCards(userId: string): Promise<CardRow[]> {
  return getDb().query<CardRow>("SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC", [userId]);
}

async function requireCard(cardId: string, userId: string): Promise<CardRow> {
  const card = await getDb().queryOne<CardRow>("SELECT * FROM cards WHERE id = ? AND user_id = ?", [cardId, userId]);
  if (!card) throw new AppError(ErrorCode.NOT_FOUND, "Card not found");
  if (card.status !== "active") throw new AppError(ErrorCode.VALIDATION, `Card is ${card.status}`);
  return card;
}

/** Authorize a purchase: place a hold on the cardholder's cash (balance + freeze + fraud gates). */
export async function authorize(input: { userId: string; cardId: string; amountMinor: bigint; merchant?: string; idempotencyKey: string; channel?: string }): Promise<CardAuthRow> {
  assertEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");
  const card = await requireCard(input.cardId, input.userId);

  const prior = await getDb().queryOne<CardAuthRow>("SELECT * FROM card_authorizations WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return prior;

  const cash = await getOrCreateUserAccount(input.userId, "user_cash", card.currency);
  const holds = await getOrCreateSystemAccount("card_holds", card.currency);

  await screenTransfer({
    eventType: "card.auth", channel: input.channel ?? "card", userId: input.userId,
    counterpartyId: input.merchant ?? "merchant", fromAccountId: cash, toAccountId: holds,
    amountMinor: input.amountMinor, currency: card.currency, idempotencyKey: input.idempotencyKey,
  });

  return getDb().transaction(async (tx) => {
    const balance = await getBalance(cash, tx);
    if (balance < input.amountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");

    const holdJournalId = await postJournal(
      [
        { ledgerAccountId: cash, direction: "debit", amountMinor: input.amountMinor, currency: card.currency },
        { ledgerAccountId: holds, direction: "credit", amountMinor: input.amountMinor, currency: card.currency },
      ],
      `Card auth ${input.merchant ?? "merchant"}`,
      { idempotencyKey: `card:auth:${input.idempotencyKey}`, db: tx }
    );

    const id = uuidv4();
    const now = new Date().toISOString();
    await tx.execute(
      `INSERT INTO card_authorizations (id, card_id, user_id, merchant, amount_minor, currency, status, hold_journal_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'authorized', ?, ?, ?)`,
      [id, card.id, input.userId, input.merchant ?? null, input.amountMinor.toString(), card.currency, holdJournalId, input.idempotencyKey, now]
    );
    cardAuthTotal.inc({ result: "authorized" });
    await logAudit({ userId: input.userId, action: "card.authorized", resource: id, details: { amountMinor: input.amountMinor.toString(), merchant: input.merchant } });
    return (await tx.queryOne<CardAuthRow>("SELECT * FROM card_authorizations WHERE id = ?", [id]))!;
  });
}

async function requireAuth(authId: string, status: string): Promise<CardAuthRow> {
  const a = await getDb().queryOne<CardAuthRow>("SELECT * FROM card_authorizations WHERE id = ?", [authId]);
  if (!a) throw new AppError(ErrorCode.NOT_FOUND, "Authorization not found");
  if (a.status !== status) throw new AppError(ErrorCode.CONFLICT, `Authorization is ${a.status}, expected ${status}`);
  return a;
}

/** Capture an authorized purchase: settle the held funds out via external_clearing. */
export async function capture(authId: string): Promise<{ captured: boolean; settleJournalId: string }> {
  assertEnabled();
  const a = await requireAuth(authId, "authorized");
  const amount = BigInt(a.amount_minor);
  const holds = await getSystemAccount("card_holds", a.currency);
  const clearing = await getSystemAccount("external_clearing", a.currency);
  const settleJournalId = await postJournal(
    [
      { ledgerAccountId: holds, direction: "debit", amountMinor: amount, currency: a.currency },
      { ledgerAccountId: clearing, direction: "credit", amountMinor: amount, currency: a.currency },
    ],
    `Card capture ${a.merchant ?? "merchant"} (${a.id})`,
    { idempotencyKey: `card:capture:${a.id}` }
  );
  await getDb().execute("UPDATE card_authorizations SET status = 'captured', settle_journal_id = ?, updated_at = ? WHERE id = ?", [settleJournalId, new Date().toISOString(), a.id]);
  cardAuthTotal.inc({ result: "captured" });
  await logAudit({ userId: a.user_id, action: "card.captured", resource: a.id });
  return { captured: true, settleJournalId };
}

/** Void an uncaptured authorization: release the hold back to the cardholder. */
export async function voidAuthorization(authId: string): Promise<{ voided: boolean }> {
  assertEnabled();
  const a = await requireAuth(authId, "authorized");
  const amount = BigInt(a.amount_minor);
  const holds = await getSystemAccount("card_holds", a.currency);
  const cash = await getOrCreateUserAccount(a.user_id, "user_cash", a.currency);
  await postJournal(
    [
      { ledgerAccountId: holds, direction: "debit", amountMinor: amount, currency: a.currency },
      { ledgerAccountId: cash, direction: "credit", amountMinor: amount, currency: a.currency },
    ],
    `Card void (${a.id})`,
    { idempotencyKey: `card:void:${a.id}` }
  );
  await getDb().execute("UPDATE card_authorizations SET status = 'voided', updated_at = ? WHERE id = ?", [new Date().toISOString(), a.id]);
  cardAuthTotal.inc({ result: "voided" });
  await logAudit({ userId: a.user_id, action: "card.voided", resource: a.id });
  return { voided: true };
}

/** Refund a captured purchase: return money to the cardholder via external_clearing. */
export async function refund(authId: string): Promise<{ refunded: boolean }> {
  assertEnabled();
  const a = await requireAuth(authId, "captured");
  const amount = BigInt(a.amount_minor);
  const clearing = await getSystemAccount("external_clearing", a.currency);
  const cash = await getOrCreateUserAccount(a.user_id, "user_cash", a.currency);
  await postJournal(
    [
      { ledgerAccountId: clearing, direction: "debit", amountMinor: amount, currency: a.currency },
      { ledgerAccountId: cash, direction: "credit", amountMinor: amount, currency: a.currency },
    ],
    `Card refund (${a.id})`,
    { idempotencyKey: `card:refund:${a.id}` }
  );
  await getDb().execute("UPDATE card_authorizations SET status = 'refunded', updated_at = ? WHERE id = ?", [new Date().toISOString(), a.id]);
  cardAuthTotal.inc({ result: "refunded" });
  await logAudit({ userId: a.user_id, action: "card.refunded", resource: a.id });
  return { refunded: true };
}

export async function listAuthorizations(userId: string, limit = 50): Promise<CardAuthRow[]> {
  return getDb().query<CardAuthRow>("SELECT * FROM card_authorizations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, Math.min(Math.max(limit, 1), 200)]);
}
