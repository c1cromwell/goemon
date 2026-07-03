/**
 * Secondary market — peer-to-peer limit order book (Phase 29 P6, the liquidity unlock).
 *
 * Makers rest orders with their funds escrowed (units for sells, cash for buys); a taker
 * crosses the book and fills at the resting (maker) price, price-time priority, partial fills
 * allowed. Buyers are compliance-checked (they receive units); zero rail fee (the Goemon wedge).
 * Every fill is one balanced journal that draws only on the two orders' escrows. No new money
 * primitive. Gated by SECONDARY_MARKET_ENABLED (prod-fatal prototype).
 *
 * See docs/TOKENIZATION-MASTER-PLAN.md (P6).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getAsset } from "./tokenizationService";
import { checkTransfer } from "./complianceService";
import {
  assetLedgerCode, getOrCreateUserAssetAccount, getOrCreateUserAccount, getOrCreateSystemAccount,
  getBalance, getAssetBalance, postJournal,
} from "./ledgerService";

export type Side = "buy" | "sell";
const ESCROW = "trade_escrow";

export interface Order {
  id: string; assetId: string; userId: string; side: Side;
  qtyTotal: bigint; qtyRemaining: bigint; limitPriceMinor: bigint; currency: string; status: string; createdAt: string;
}
interface OrderRow {
  id: string; asset_id: string; user_id: string; side: string; qty_total: string; qty_remaining: string;
  limit_price_minor: string; currency: string; status: string; idempotency_key: string | null; created_at: string;
}
function toOrder(r: OrderRow): Order {
  return {
    id: r.id, assetId: r.asset_id, userId: r.user_id, side: r.side as Side, qtyTotal: BigInt(r.qty_total),
    qtyRemaining: BigInt(r.qty_remaining), limitPriceMinor: BigInt(r.limit_price_minor), currency: r.currency,
    status: r.status, createdAt: r.created_at,
  };
}

export interface Trade { id: string; assetId: string; qty: string; priceMinor: string; currency: string; buyerUserId: string; sellerUserId: string; createdAt: string }

export function assertSecondaryMarketEnabled(): void {
  if (!config.SECONDARY_MARKET_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "The secondary market is not enabled (set SECONDARY_MARKET_ENABLED=true).");
  }
}

async function orderById(id: string): Promise<Order> {
  const r = await getDb().queryOne<OrderRow>("SELECT * FROM trade_orders WHERE id = ?", [id]);
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "Order not found");
  return toOrder(r);
}

export interface PlaceResult { order: Order; fills: Trade[] }

export async function placeOrder(input: {
  assetId: string; userId: string; side: Side; qty: bigint; limitPriceMinor: bigint; currency?: string; idempotencyKey: string;
}): Promise<PlaceResult> {
  assertSecondaryMarketEnabled();
  const prior = await getDb().queryOne<OrderRow>("SELECT * FROM trade_orders WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return { order: toOrder(prior), fills: [] };

  if (input.qty <= 0n) throw new AppError(ErrorCode.VALIDATION, "qty must be positive");
  if (input.limitPriceMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "limit price must be positive");
  const asset = await getAsset(input.assetId);
  if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  const currency = input.currency ?? "USD";
  const code = assetLedgerCode(input.assetId);

  // Escrow the maker's funds up front.
  if (input.side === "sell") {
    if ((await getAssetBalance(input.userId, input.assetId)) < input.qty) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "You don't hold enough units to sell");
    const holder = await getOrCreateUserAssetAccount(input.userId, input.assetId);
    const escrow = await getOrCreateSystemAccount(ESCROW, code);
    await postJournal(
      [{ ledgerAccountId: holder, direction: "debit", amountMinor: input.qty, currency: code },
       { ledgerAccountId: escrow, direction: "credit", amountMinor: input.qty, currency: code }],
      `Order escrow (sell) ${input.assetId}`, { idempotencyKey: `trade:escrow:${input.idempotencyKey}` }
    );
  } else {
    // Buyer receives units → compliance-gated.
    const compliance = await checkTransfer(asset, input.userId);
    if (!compliance.allowed) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, compliance.reason ?? "Not eligible to hold this asset");
    const cost = input.qty * input.limitPriceMinor;
    const cash = await getOrCreateUserAccount(input.userId, "user_cash", currency);
    if ((await getBalance(cash)) < cost) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient cash to place this buy");
    const escrow = await getOrCreateSystemAccount(ESCROW, currency);
    await postJournal(
      [{ ledgerAccountId: cash, direction: "debit", amountMinor: cost, currency },
       { ledgerAccountId: escrow, direction: "credit", amountMinor: cost, currency }],
      `Order escrow (buy) ${input.assetId}`, { idempotencyKey: `trade:escrow:${input.idempotencyKey}` }
    );
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO trade_orders (id, asset_id, user_id, side, qty_total, qty_remaining, limit_price_minor, currency, status, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [id, input.assetId, input.userId, input.side, input.qty.toString(), input.qty.toString(), input.limitPriceMinor.toString(), currency, input.idempotencyKey, now]
  );

  const fills = await match(await orderById(id), asset, currency, code);
  await logAudit({ userId: input.userId, action: "trade.order", resource: id, details: { side: input.side, qty: input.qty.toString(), price: input.limitPriceMinor.toString(), fills: fills.length } });
  return { order: await orderById(id), fills };
}

/** Cross `taker` against the resting book, executing fills at the maker price. */
async function match(taker: Order, asset: Awaited<ReturnType<typeof getAsset>>, currency: string, code: string): Promise<Trade[]> {
  const oppSide: Side = taker.side === "buy" ? "sell" : "buy";
  const rows = await getDb().query<OrderRow>(
    "SELECT * FROM trade_orders WHERE asset_id = ? AND side = ? AND status = 'open' AND user_id != ?",
    [taker.assetId, oppSide, taker.userId]
  );
  const resting = rows.map(toOrder)
    // Only crossing orders.
    .filter((o) => taker.side === "buy" ? o.limitPriceMinor <= taker.limitPriceMinor : o.limitPriceMinor >= taker.limitPriceMinor)
    // Best price first (asks ascending for a buy taker; bids descending for a sell taker), then oldest.
    .sort((x, y) => x.limitPriceMinor === y.limitPriceMinor
      ? x.createdAt.localeCompare(y.createdAt)
      : taker.side === "buy" ? Number(x.limitPriceMinor - y.limitPriceMinor) : Number(y.limitPriceMinor - x.limitPriceMinor));

  const escrowCash = await getOrCreateSystemAccount(ESCROW, currency);
  const escrowUnits = await getOrCreateSystemAccount(ESCROW, code);
  let takerRemaining = taker.qtyRemaining;
  const fills: Trade[] = [];

  for (const maker of resting) {
    if (takerRemaining <= 0n) break;
    const fillQty = takerRemaining < maker.qtyRemaining ? takerRemaining : maker.qtyRemaining;
    const execPrice = maker.limitPriceMinor; // maker sets the price

    const buyOrder = taker.side === "buy" ? taker : maker;
    const sellOrder = taker.side === "buy" ? maker : taker;
    const buyer = buyOrder.userId, seller = sellOrder.userId;
    const cost = fillQty * execPrice;
    const buyerSurplus = fillQty * (buyOrder.limitPriceMinor - execPrice); // buyer escrowed at their limit

    const buyerAsset = await getOrCreateUserAssetAccount(buyer, taker.assetId);
    const sellerCash = await getOrCreateUserAccount(seller, "user_cash", currency);
    const buyerCash = await getOrCreateUserAccount(buyer, "user_cash", currency);
    const tradeId = uuidv4();

    const entries = [
      // cash: pay the seller from the buyer's escrow
      { ledgerAccountId: escrowCash, direction: "debit" as const, amountMinor: cost, currency },
      { ledgerAccountId: sellerCash, direction: "credit" as const, amountMinor: cost, currency },
      // units: deliver to the buyer from the seller's escrow
      { ledgerAccountId: escrowUnits, direction: "debit" as const, amountMinor: fillQty, currency: code },
      { ledgerAccountId: buyerAsset, direction: "credit" as const, amountMinor: fillQty, currency: code },
    ];
    if (buyerSurplus > 0n) {
      entries.push({ ledgerAccountId: escrowCash, direction: "debit", amountMinor: buyerSurplus, currency });
      entries.push({ ledgerAccountId: buyerCash, direction: "credit", amountMinor: buyerSurplus, currency });
    }
    const journalId = await postJournal(entries, `Secondary trade ${taker.assetId}`, { idempotencyKey: `trade:fill:${tradeId}` });

    const now = new Date().toISOString();
    await getDb().execute(
      `INSERT INTO trades (id, asset_id, buy_order_id, sell_order_id, buyer_user_id, seller_user_id, qty, price_minor, currency, journal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tradeId, taker.assetId, buyOrder.id, sellOrder.id, buyer, seller, fillQty.toString(), execPrice.toString(), currency, journalId, now]
    );

    // Advance both orders.
    const makerLeft = maker.qtyRemaining - fillQty;
    await getDb().execute("UPDATE trade_orders SET qty_remaining = ?, status = ? WHERE id = ?", [makerLeft.toString(), makerLeft <= 0n ? "filled" : "open", maker.id]);
    takerRemaining -= fillQty;
    fills.push({ id: tradeId, assetId: taker.assetId, qty: fillQty.toString(), priceMinor: execPrice.toString(), currency, buyerUserId: buyer, sellerUserId: seller, createdAt: now });
  }

  await getDb().execute("UPDATE trade_orders SET qty_remaining = ?, status = ? WHERE id = ?", [takerRemaining.toString(), takerRemaining <= 0n ? "filled" : "open", taker.id]);
  return fills;
}

export async function cancelOrder(orderId: string, userId: string): Promise<Order> {
  assertSecondaryMarketEnabled();
  const order = await orderById(orderId);
  if (order.userId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your order");
  if (order.status !== "open") throw new AppError(ErrorCode.CONFLICT, "Order is not open");
  const code = assetLedgerCode(order.assetId);

  if (order.qtyRemaining > 0n) {
    if (order.side === "sell") {
      const escrow = await getOrCreateSystemAccount(ESCROW, code);
      const holder = await getOrCreateUserAssetAccount(userId, order.assetId);
      await postJournal(
        [{ ledgerAccountId: escrow, direction: "debit", amountMinor: order.qtyRemaining, currency: code },
         { ledgerAccountId: holder, direction: "credit", amountMinor: order.qtyRemaining, currency: code }],
        `Order cancel refund ${order.id}`, { idempotencyKey: `trade:cancel:${order.id}` }
      );
    } else {
      const refund = order.qtyRemaining * order.limitPriceMinor;
      const escrow = await getOrCreateSystemAccount(ESCROW, order.currency);
      const cash = await getOrCreateUserAccount(userId, "user_cash", order.currency);
      await postJournal(
        [{ ledgerAccountId: escrow, direction: "debit", amountMinor: refund, currency: order.currency },
         { ledgerAccountId: cash, direction: "credit", amountMinor: refund, currency: order.currency }],
        `Order cancel refund ${order.id}`, { idempotencyKey: `trade:cancel:${order.id}` }
      );
    }
  }
  await getDb().execute("UPDATE trade_orders SET status = 'cancelled' WHERE id = ?", [order.id]);
  await logAudit({ userId, action: "trade.cancel", resource: order.id });
  return orderById(order.id);
}

export interface BookLevel { priceMinor: string; qty: string }
export async function getBook(assetId: string): Promise<{ bids: BookLevel[]; asks: BookLevel[] }> {
  const rows = (await getDb().query<OrderRow>("SELECT * FROM trade_orders WHERE asset_id = ? AND status = 'open'", [assetId])).map(toOrder);
  const agg = (side: Side, desc: boolean): BookLevel[] => {
    const m = new Map<string, bigint>();
    for (const o of rows.filter((r) => r.side === side)) {
      const k = o.limitPriceMinor.toString();
      m.set(k, (m.get(k) ?? 0n) + o.qtyRemaining);
    }
    return [...m.entries()]
      .sort((a, b) => desc ? Number(BigInt(b[0]) - BigInt(a[0])) : Number(BigInt(a[0]) - BigInt(b[0])))
      .map(([priceMinor, qty]) => ({ priceMinor, qty: qty.toString() }));
  };
  return { bids: agg("buy", true), asks: agg("sell", false) };
}

export async function listMyOrders(userId: string): Promise<Order[]> {
  return (await getDb().query<OrderRow>("SELECT * FROM trade_orders WHERE user_id = ? ORDER BY created_at DESC", [userId])).map(toOrder);
}

export async function listTrades(assetId: string, limit = 50): Promise<Trade[]> {
  const rows = await getDb().query<{ id: string; asset_id: string; qty: string; price_minor: string; currency: string; buyer_user_id: string; seller_user_id: string; created_at: string }>(
    "SELECT * FROM trades WHERE asset_id = ? ORDER BY created_at DESC LIMIT ?", [assetId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => ({ id: r.id, assetId: r.asset_id, qty: r.qty, priceMinor: r.price_minor, currency: r.currency, buyerUserId: r.buyer_user_id, sellerUserId: r.seller_user_id, createdAt: r.created_at }));
}
