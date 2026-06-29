/**
 * USDC → fiat off-ramp (prototype seam). The symmetric exit to the on-ramp: a user sells
 * USDC and receives fiat in a linked bank/card. Users won't put real money onto the rail
 * unless they can get it off — this closes the loop.
 *
 * Phase-A posture (mirror of the on-ramp): the licensed provider (MoonPay/Stripe/Coinbase)
 * takes the USDC AND delivers the fiat under ITS own license; Goemon only debits the user's
 * USDC ledger balance (net of the off-ramp fee) and records the payout reference.
 *
 *   sell:  user_cash(USDC) → offramp_settlement(USDC) net,  fee → fee(USDC)
 *
 * Money leaving the platform, so it rides the same guards as a bank withdrawal:
 * account-freeze gate, fraud screen (`offramp.sell`), and an authoritative balance check
 * inside the debit transaction. Idempotent (offramp_orders.idempotency_key + the journal),
 * append-only at the ledger, integer minor units. Off by default behind OFFRAMP_ENABLED;
 * prod-fatal while OFFRAMP_PROVIDER=simulated.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { screenTransfer } from "./fraudService";
import { offrampOrderTotal } from "../observability/metrics";
import { getBalance, getOrCreateUserAccount, getOrCreateSystemAccount, postJournal } from "./ledgerService";

const ASSET = "USDC";
const USDC_DECIMALS = 6;
const FIAT_DECIMALS = 2;
const RATE_PPM = 1_000_000; // simulated 1:1 USDC↔USD value

function assertEnabled(): void {
  if (!config.OFFRAMP_ENABLED) throw new AppError(ErrorCode.OFFRAMP_DISABLED, "The off-ramp is currently unavailable");
}

export interface OffRampQuote {
  provider: string;
  usdcAmountMinor: bigint;   // USDC the user sells
  feeMinor: bigint;          // off-ramp fee (micro-USDC)
  usdcNetMinor: bigint;      // USDC converted to fiat
  fiatAmountMinor: bigint;   // fiat received (cents)
  fiatCurrency: string;
  asset: string;
  ratePpm: number;
  feeBps: number;
}

/** A swappable off-ramp provider. Simulated pays out instantly; the real ones initiate a
 *  fiat payout under their license (a webhook would confirm settlement in production). */
export interface OffRampProvider {
  name: string;
  initiatePayout(input: { userId: string; usdcNetMinor: bigint; fiatAmountMinor: bigint; fiatCurrency: string; destination?: string }):
    Promise<{ externalRef: string; settled: boolean }>;
}

function simulatedProvider(): OffRampProvider {
  return {
    name: "simulated",
    async initiatePayout() {
      return { externalRef: `sim_offramp_${uuidv4().slice(0, 12)}`, settled: true };
    },
  };
}

function notImplemented(name: string): OffRampProvider {
  return {
    name,
    async initiatePayout() {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `Off-ramp provider '${name}' is not wired in this prototype`);
    },
  };
}

let provider: OffRampProvider | null = null;
export function setOffRampProvider(p: OffRampProvider | null): void { provider = p; }
export function getOffRampProvider(): OffRampProvider {
  if (provider) return provider;
  switch (config.OFFRAMP_PROVIDER) {
    case "moonpay": return notImplemented("moonpay");
    case "stripe": return notImplemented("stripe");
    case "coinbase": return notImplemented("coinbase");
    default: return simulatedProvider();
  }
}

/** Convert a USDC (6dp) amount to its fiat (2dp) value at the current rate. */
function usdcToFiatMinor(usdcMinor: bigint): bigint {
  const scale = 10n ** BigInt(USDC_DECIMALS - FIAT_DECIMALS); // 10_000
  return (usdcMinor * BigInt(RATE_PPM)) / (1_000_000n * scale);
}

export function quote(input: { usdcAmountMinor: bigint; fiatCurrency?: string }): OffRampQuote {
  assertEnabled();
  const fiatCurrency = input.fiatCurrency ?? "USD";
  if (input.usdcAmountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (fiatCurrency !== "USD") throw new AppError(ErrorCode.VALIDATION, "Only USD off-ramp is supported in this prototype");

  const feeMinor = (input.usdcAmountMinor * BigInt(config.OFFRAMP_FEE_BPS)) / 10_000n;
  const usdcNetMinor = input.usdcAmountMinor - feeMinor;
  const fiatAmountMinor = usdcToFiatMinor(usdcNetMinor);
  return {
    provider: getOffRampProvider().name,
    usdcAmountMinor: input.usdcAmountMinor,
    feeMinor,
    usdcNetMinor,
    fiatAmountMinor,
    fiatCurrency,
    asset: ASSET,
    ratePpm: RATE_PPM,
    feeBps: config.OFFRAMP_FEE_BPS,
  };
}

interface OffRampOrderRow {
  id: string; user_id: string; provider: string; usdc_amount_minor: string; fee_minor: string;
  usdc_net_minor: string; fiat_amount_minor: string; fiat_currency: string; asset: string; rate_ppm: string;
  destination: string | null; status: string; external_ref: string | null; journal_id: string | null;
  idempotency_key: string | null; created_at: string; completed_at: string | null;
}

export interface OffRampOrder {
  id: string; provider: string; status: string;
  usdcAmountMinor: string; feeMinor: string; usdcNetMinor: string;
  fiatAmountMinor: string; fiatCurrency: string; asset: string; ratePpm: string;
  destination: string | null; externalRef: string | null; journalId: string | null;
  createdAt: string; completedAt: string | null;
}

function toOrder(r: OffRampOrderRow): OffRampOrder {
  // Money is always surfaced as a string (minor units), never a JS number.
  return {
    id: r.id, provider: r.provider, status: r.status,
    usdcAmountMinor: String(r.usdc_amount_minor), feeMinor: String(r.fee_minor), usdcNetMinor: String(r.usdc_net_minor),
    fiatAmountMinor: String(r.fiat_amount_minor), fiatCurrency: r.fiat_currency, asset: r.asset, ratePpm: String(r.rate_ppm),
    destination: r.destination, externalRef: r.external_ref, journalId: r.journal_id,
    createdAt: r.created_at, completedAt: r.completed_at,
  };
}

async function existingByKey(key: string): Promise<OffRampOrderRow | null> {
  return getDb().queryOne<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE idempotency_key = ?", [key]);
}

/** Sell USDC for fiat: debit the user's USDC (net to settlement, fee to fee) and initiate
 *  the provider's fiat payout. Idempotent; money-leaving guards apply. */
export async function createOrder(input: {
  userId: string; usdcAmountMinor: bigint; fiatCurrency?: string; destination?: string; idempotencyKey: string;
}): Promise<OffRampOrder> {
  assertEnabled();
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const prior = await existingByKey(input.idempotencyKey);
  if (prior) return toOrder(prior);

  const q = quote({ usdcAmountMinor: input.usdcAmountMinor, fiatCurrency: input.fiatCurrency });

  const cash = await getOrCreateUserAccount(input.userId, "user_cash", ASSET);
  const settlement = await getOrCreateSystemAccount("offramp_settlement", ASSET);

  // Money leaving the platform — screen it (degrades open; the balance check is authoritative).
  await screenTransfer({
    eventType: "bank.withdraw", channel: "offramp", userId: input.userId,
    counterpartyId: input.destination ?? "external", fromAccountId: cash, toAccountId: settlement,
    amountMinor: input.usdcAmountMinor, currency: ASSET, idempotencyKey: input.idempotencyKey,
  });

  const db = getDb();
  const { id, journalId, externalRef, status, completedAt } = await db.transaction(async (tx) => {
    const balance = await getBalance(cash, tx);
    if (balance < input.usdcAmountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient USDC balance");

    const ext = await getOffRampProvider().initiatePayout({
      userId: input.userId, usdcNetMinor: q.usdcNetMinor, fiatAmountMinor: q.fiatAmountMinor, fiatCurrency: q.fiatCurrency, destination: input.destination,
    });

    const entries = [
      { ledgerAccountId: cash, direction: "debit" as const, amountMinor: input.usdcAmountMinor, currency: ASSET },
      { ledgerAccountId: settlement, direction: "credit" as const, amountMinor: q.usdcNetMinor, currency: ASSET },
    ];
    if (q.feeMinor > 0n) {
      const feeAcct = await getOrCreateSystemAccount("fee", ASSET);
      entries.push({ ledgerAccountId: feeAcct, direction: "credit" as const, amountMinor: q.feeMinor, currency: ASSET });
    }
    const jid = await postJournal(entries, `Off-ramp sell (${ext.externalRef})`, {
      idempotencyKey: `offramp:${input.idempotencyKey}`, externalRef: ext.externalRef, db: tx,
    });

    const orderId = uuidv4();
    const st = ext.settled ? "completed" : "pending";
    const done = ext.settled ? new Date().toISOString() : null;
    await tx.execute(
      `INSERT INTO offramp_orders (id, user_id, provider, usdc_amount_minor, fee_minor, usdc_net_minor, fiat_amount_minor, fiat_currency, asset, rate_ppm, destination, status, external_ref, journal_id, idempotency_key, created_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId, input.userId, getOffRampProvider().name, input.usdcAmountMinor.toString(), q.feeMinor.toString(), q.usdcNetMinor.toString(),
       q.fiatAmountMinor.toString(), q.fiatCurrency, ASSET, RATE_PPM.toString(), input.destination ?? null, st, ext.externalRef, jid,
       input.idempotencyKey, new Date().toISOString(), done]
    );
    return { id: orderId, journalId: jid, externalRef: ext.externalRef, status: st, completedAt: done };
  });

  offrampOrderTotal.inc({ provider: getOffRampProvider().name, result: status === "completed" ? "completed" : "pending" });
  await logAudit({ userId: input.userId, action: "offramp.sell", resource: id, details: { usdcAmountMinor: input.usdcAmountMinor.toString(), fiatAmountMinor: q.fiatAmountMinor.toString(), provider: getOffRampProvider().name, status } });

  const saved = await db.queryOne<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE id = ?", [id]);
  if (saved) return toOrder(saved);
  void journalId; void externalRef; void completedAt;
  throw new AppError(ErrorCode.INTERNAL, "Off-ramp order not persisted");
}

/** Complete a pending order (the real provider's payout-settled webhook). Idempotent. */
export async function completeOrder(externalRef: string): Promise<OffRampOrder> {
  assertEnabled();
  const row = await getDb().queryOne<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE external_ref = ?", [externalRef]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Off-ramp order not found");
  if (row.status === "completed") return toOrder(row);
  if (row.status !== "pending") throw new AppError(ErrorCode.CONFLICT, "Order is not pending");
  // The USDC was already debited at order time; settling the fiat payout only advances status.
  const completedAt = new Date().toISOString();
  await getDb().execute("UPDATE offramp_orders SET status = 'completed', completed_at = ? WHERE id = ?", [completedAt, row.id]);
  offrampOrderTotal.inc({ provider: row.provider, result: "completed" });
  await logAudit({ userId: row.user_id, action: "offramp.complete", resource: row.id, details: { externalRef } });
  const saved = await getDb().queryOne<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE id = ?", [row.id]);
  return toOrder(saved ?? { ...row, status: "completed", completed_at: completedAt });
}

export async function getOrder(userId: string, orderId: string): Promise<OffRampOrder> {
  const row = await getDb().queryOne<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE id = ? AND user_id = ?", [orderId, userId]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Off-ramp order not found");
  return toOrder(row);
}

export async function listOrders(userId: string): Promise<OffRampOrder[]> {
  const rows = await getDb().query<OffRampOrderRow>("SELECT * FROM offramp_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [userId]);
  return rows.map(toOrder);
}
