/**
 * Fiat → USDC on-ramp (prototype seam). Buy USDC with fiat — the highest-leverage
 * activation gap: it's how a new user gets their first dollars onto the native rail.
 *
 * Phase-A posture (CORPORATE-STRUCTURE "route to a licensed third party"): the real
 * providers (MoonPay / Stripe Crypto / Coinbase) take the user's fiat AND run KYC/AML
 * under THEIR own license, then deliver USDC to the user. Goemon never custodies the
 * fiat — it only credits the delivered USDC into the ledger. That keeps the on-ramp
 * Phase-A-safe (no MSB needed) while moving volume onto the own-rail USDC balance.
 *
 *   buy:  onramp_settlement(USDC) → user_cash(USDC) net,  fee → fee(USDC)
 *
 * The simulated provider models instant delivery (the prototype default). A real
 * provider returns a hosted-widget redirect_url and the USDC is credited on the
 * provider's webhook (completeOrder) — the order sits `pending` until then.
 *
 * Idempotent (onramp_orders.idempotency_key + the delivery journal), append-only at
 * the ledger, integer minor units. Off by default behind ONRAMP_ENABLED; prod-fatal
 * while ONRAMP_PROVIDER=simulated (a real launch must wire a licensed on-ramp).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { onrampOrderTotal } from "../observability/metrics";
import { getOrCreateUserAccount, getOrCreateSystemAccount, postJournal } from "./ledgerService";

const ASSET = "USDC";
// Value rate fiat → USDC, expressed as parts-per-million (1:1 = 1e6). Fiat is 2dp
// (cents); USDC is 6dp (micro). 100 cents of value = 1_000_000 micro → ×10_000.
const FIAT_DECIMALS = 2;
const USDC_DECIMALS = 6;
const RATE_PPM = 1_000_000; // simulated 1:1 USD↔USDC value

function assertEnabled(): void {
  if (!config.ONRAMP_ENABLED) throw new AppError(ErrorCode.ONRAMP_DISABLED, "The on-ramp is currently unavailable");
}

export interface OnRampQuote {
  provider: string;
  fiatAmountMinor: bigint;
  fiatCurrency: string;
  asset: string;
  usdcGrossMinor: bigint; // USDC value before fee
  feeMinor: bigint;       // on-ramp fee (micro-USDC)
  usdcNetMinor: bigint;   // what the user receives
  ratePpm: number;
  feeBps: number;
}

/** A swappable on-ramp provider. The simulated one delivers instantly; the real ones
 *  hand back a hosted-widget URL and deliver via webhook (completeOrder). */
export interface OnRampProvider {
  name: string;
  /** Start a purchase. `instant` simulated providers report delivered=true. */
  createOrder(input: { userId: string; fiatAmountMinor: bigint; fiatCurrency: string; asset: string }):
    Promise<{ externalRef: string; redirectUrl: string | null; delivered: boolean }>;
}

function simulatedProvider(): OnRampProvider {
  return {
    name: "simulated",
    async createOrder() {
      return { externalRef: `sim_onramp_${uuidv4().slice(0, 12)}`, redirectUrl: null, delivered: true };
    },
  };
}

function notImplemented(name: string): OnRampProvider {
  return {
    name,
    async createOrder() {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `On-ramp provider '${name}' is not wired in this prototype`);
    },
  };
}

let provider: OnRampProvider | null = null;
export function setOnRampProvider(p: OnRampProvider | null): void { provider = p; }
export function getOnRampProvider(): OnRampProvider {
  if (provider) return provider;
  switch (config.ONRAMP_PROVIDER) {
    case "moonpay": return notImplemented("moonpay");
    case "stripe": return notImplemented("stripe");
    case "coinbase": return notImplemented("coinbase");
    default: return simulatedProvider();
  }
}

/** Convert a fiat (2dp) amount to its USDC (6dp) value at the current rate. */
function fiatToUsdcMinor(fiatMinor: bigint): bigint {
  const scale = 10n ** BigInt(USDC_DECIMALS - FIAT_DECIMALS); // 10_000
  return (fiatMinor * scale * BigInt(RATE_PPM)) / 1_000_000n;
}

export function quote(input: { fiatAmountMinor: bigint; fiatCurrency?: string }): OnRampQuote {
  assertEnabled();
  const fiatCurrency = input.fiatCurrency ?? "USD";
  if (input.fiatAmountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (fiatCurrency !== "USD") throw new AppError(ErrorCode.VALIDATION, "Only USD on-ramp is supported in this prototype");

  const usdcGrossMinor = fiatToUsdcMinor(input.fiatAmountMinor);
  const feeMinor = (usdcGrossMinor * BigInt(config.ONRAMP_FEE_BPS)) / 10_000n;
  const usdcNetMinor = usdcGrossMinor - feeMinor;
  return {
    provider: getOnRampProvider().name,
    fiatAmountMinor: input.fiatAmountMinor,
    fiatCurrency,
    asset: ASSET,
    usdcGrossMinor,
    feeMinor,
    usdcNetMinor,
    ratePpm: RATE_PPM,
    feeBps: config.ONRAMP_FEE_BPS,
  };
}

interface OnRampOrderRow {
  id: string; user_id: string; provider: string; fiat_amount_minor: string; fiat_currency: string;
  asset: string; usdc_gross_minor: string; fee_minor: string; usdc_net_minor: string; rate_ppm: number;
  status: string; external_ref: string | null; redirect_url: string | null; journal_id: string | null;
  idempotency_key: string | null; created_at: string; completed_at: string | null;
}

export interface OnRampOrder {
  id: string; provider: string; status: string;
  fiatAmountMinor: string; fiatCurrency: string; asset: string;
  usdcGrossMinor: string; feeMinor: string; usdcNetMinor: string; ratePpm: number;
  externalRef: string | null; redirectUrl: string | null; journalId: string | null;
  createdAt: string; completedAt: string | null;
}

function toOrder(r: OnRampOrderRow): OnRampOrder {
  // Money is always surfaced as a string (minor units) regardless of how the driver
  // typed the column — never a JS number (bigint-precision discipline).
  return {
    id: r.id, provider: r.provider, status: r.status,
    fiatAmountMinor: String(r.fiat_amount_minor), fiatCurrency: r.fiat_currency, asset: r.asset,
    usdcGrossMinor: String(r.usdc_gross_minor), feeMinor: String(r.fee_minor), usdcNetMinor: String(r.usdc_net_minor), ratePpm: r.rate_ppm,
    externalRef: r.external_ref, redirectUrl: r.redirect_url, journalId: r.journal_id,
    createdAt: r.created_at, completedAt: r.completed_at,
  };
}

async function existingByKey(key: string): Promise<OnRampOrderRow | null> {
  return getDb().queryOne<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE idempotency_key = ?", [key]);
}

/**
 * Deliver the purchased USDC into the ledger (onramp_settlement → user_cash net, fee → fee).
 * Shared by the simulated instant path and the real-provider webhook (completeOrder).
 */
async function deliver(order: OnRampOrderRow): Promise<string> {
  const gross = BigInt(order.usdc_gross_minor);
  const fee = BigInt(order.fee_minor);
  const net = BigInt(order.usdc_net_minor);
  const settlement = await getOrCreateSystemAccount("onramp_settlement", ASSET);
  const cash = await getOrCreateUserAccount(order.user_id, "user_cash", ASSET);
  const entries = [
    { ledgerAccountId: settlement, direction: "debit" as const, amountMinor: gross, currency: ASSET },
    { ledgerAccountId: cash, direction: "credit" as const, amountMinor: net, currency: ASSET },
  ];
  if (fee > 0n) {
    const feeAcct = await getOrCreateSystemAccount("fee", ASSET);
    entries.push({ ledgerAccountId: feeAcct, direction: "credit" as const, amountMinor: fee, currency: ASSET });
  }
  return postJournal(entries, `On-ramp purchase (${order.external_ref})`, {
    idempotencyKey: `onramp:${order.id}`, externalRef: order.external_ref ?? undefined,
  });
}

/** Start (and, for the simulated provider, complete) a fiat→USDC purchase. */
export async function createOrder(input: {
  userId: string; fiatAmountMinor: bigint; fiatCurrency?: string; idempotencyKey: string;
}): Promise<OnRampOrder> {
  assertEnabled();
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const prior = await existingByKey(input.idempotencyKey);
  if (prior) return toOrder(prior);

  const q = quote({ fiatAmountMinor: input.fiatAmountMinor, fiatCurrency: input.fiatCurrency });
  const p = getOnRampProvider();
  const ext = await p.createOrder({ userId: input.userId, fiatAmountMinor: q.fiatAmountMinor, fiatCurrency: q.fiatCurrency, asset: ASSET });

  const id = uuidv4();
  const row: OnRampOrderRow = {
    id, user_id: input.userId, provider: p.name, fiat_amount_minor: q.fiatAmountMinor.toString(), fiat_currency: q.fiatCurrency,
    asset: ASSET, usdc_gross_minor: q.usdcGrossMinor.toString(), fee_minor: q.feeMinor.toString(), usdc_net_minor: q.usdcNetMinor.toString(),
    rate_ppm: q.ratePpm, status: "pending", external_ref: ext.externalRef, redirect_url: ext.redirectUrl, journal_id: null,
    idempotency_key: input.idempotencyKey, created_at: new Date().toISOString(), completed_at: null,
  };

  let journalId: string | null = null;
  let status = "pending";
  let completedAt: string | null = null;
  if (ext.delivered) {
    journalId = await deliver(row);
    status = "completed";
    completedAt = new Date().toISOString();
  }

  await getDb().execute(
    `INSERT INTO onramp_orders (id, user_id, provider, fiat_amount_minor, fiat_currency, asset, usdc_gross_minor, fee_minor, usdc_net_minor, rate_ppm, status, external_ref, redirect_url, journal_id, idempotency_key, created_at, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.userId, p.name, row.fiat_amount_minor, row.fiat_currency, ASSET, row.usdc_gross_minor, row.fee_minor, row.usdc_net_minor,
     row.rate_ppm, status, ext.externalRef, ext.redirectUrl, journalId, input.idempotencyKey, row.created_at, completedAt]
  );

  onrampOrderTotal.inc({ provider: p.name, result: status === "completed" ? "completed" : "pending" });
  await logAudit({ userId: input.userId, action: "onramp.purchase", resource: id, details: { fiatAmountMinor: row.fiat_amount_minor, usdcNetMinor: row.usdc_net_minor, provider: p.name, status } });

  const saved = await getDb().queryOne<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE id = ?", [id]);
  return toOrder(saved ?? { ...row, status, journal_id: journalId, completed_at: completedAt });
}

/** Complete a pending order (the real provider's delivery webhook). Idempotent. */
export async function completeOrder(externalRef: string): Promise<OnRampOrder> {
  assertEnabled();
  const row = await getDb().queryOne<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE external_ref = ?", [externalRef]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "On-ramp order not found");
  if (row.status === "completed") return toOrder(row);
  if (row.status !== "pending") throw new AppError(ErrorCode.CONFLICT, "Order is not pending");

  const journalId = await deliver(row);
  const completedAt = new Date().toISOString();
  await getDb().execute("UPDATE onramp_orders SET status = 'completed', journal_id = ?, completed_at = ? WHERE id = ?", [journalId, completedAt, row.id]);
  onrampOrderTotal.inc({ provider: row.provider, result: "completed" });
  await logAudit({ userId: row.user_id, action: "onramp.complete", resource: row.id, details: { externalRef } });

  const saved = await getDb().queryOne<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE id = ?", [row.id]);
  return toOrder(saved ?? { ...row, status: "completed", journal_id: journalId, completed_at: completedAt });
}

export async function getOrder(userId: string, orderId: string): Promise<OnRampOrder> {
  const row = await getDb().queryOne<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE id = ? AND user_id = ?", [orderId, userId]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "On-ramp order not found");
  return toOrder(row);
}

export async function listOrders(userId: string): Promise<OnRampOrder[]> {
  const rows = await getDb().query<OnRampOrderRow>("SELECT * FROM onramp_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [userId]);
  return rows.map(toOrder);
}
