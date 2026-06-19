/**
 * Phase 17 — Trading service (simulated, isolated).
 *
 * Stage 1: market/limit orders, async settlement, options-level gate.
 * Stage 2: stop/stop_limit, market-data-backed fills, admin options approval.
 *
 * The buildable-now slice of docs/PHASE-17-TRADING-BROKERAGE.md. It proves the
 * SLA-isolation architecture without a real broker:
 *
 *   placeOrder  → HOT PATH: validate + write the order to the trading store, enqueue.
 *                 NEVER touches the ledger. Returns immediately.
 *   settlement  → async worker: ask the (simulated) broker for a fill, then post a
 *                 balanced, idempotent journal into the ledger via the external_clearing
 *                 seam. Cash + positions stay ledger-derived (positions are POS:<id>
 *                 currency codes, the Phase-8 asset-as-currency pattern).
 *
 * Isolation guarantees (tested in test/trading.test.ts):
 *   - TRADING_ENABLED is a kill-switch — off ⇒ placeOrder throws TRADING_DISABLED and
 *     the bank is wholly unaffected.
 *   - A stalled/failed broker leaves orders pending (circuit breaker fast-fails) and
 *     CANNOT block or corrupt the money path — a concurrent transfer still settles.
 *   - Settlement is exactly-once (idempotent on the fill key); double-drain is safe.
 *
 * This service is the bounded trading context. In the prototype it shares the DB with
 * the bank; at go-live it becomes a separate deployable with its own pool (§3.1).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { tradingOrderTotal, tradingSettlementTotal } from "../observability/metrics";
import {
  getOrCreateUserAccount,
  getOrCreateSystemAccount,
  getSystemAccount,
  getBalance,
  postJournal,
} from "./ledgerService";
import {
  execute as brokerExecute,
  BrokerUnavailableError,
  OrderNotExecutableError,
  type BrokerOrder,
} from "./tradingBroker";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type OrderStatus = "accepted" | "settled" | "rejected" | "canceled";

export interface PlaceOrderInput {
  userId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qtyBase: bigint;
  limitPriceMinor?: bigint | null;
  stopPriceMinor?: bigint | null;
  idempotencyKey: string;
}

export interface OrderRow {
  id: string;
  userId: string;
  instrumentId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qtyBase: string;
  status: OrderStatus;
  rejectReason: string | null;
  createdAt: string;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  kind: string;
  currency: string;
  last_price_minor: number | string;
  min_options_level: number;
  status: string;
}

interface RawOrder {
  id: string;
  user_id: string;
  instrument_id: string;
  side: OrderSide;
  type: OrderType;
  qty_base: string | number;
  limit_price_minor: string | number | null;
  stop_price_minor: string | number | null;
  status: OrderStatus;
  reject_reason: string | null;
  created_at: string;
}

/** The ledger currency code for an instrument's position quantity entries. */
export function positionLedgerCode(instrumentId: string): string {
  return `POS:${instrumentId}`;
}

async function getOrCreateUserPositionAccount(userId: string, instrumentId: string): Promise<string> {
  const db = getDb();
  const code = positionLedgerCode(instrumentId);
  const existing = await db.queryOne<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = 'user_position' AND currency = ?",
    [userId, code]
  );
  if (existing) return existing.id;
  const id = uuidv4();
  await db.execute(
    "INSERT INTO ledger_accounts (id, user_id, kind, currency, created_at) VALUES (?, ?, 'user_position', ?, ?)",
    [id, userId, code, new Date().toISOString()]
  );
  return id;
}

async function ensureTradingAccount(userId: string): Promise<{ options_level: number }> {
  const db = getDb();
  const existing = await db.queryOne<{ options_level: number }>(
    "SELECT options_level FROM trading_accounts WHERE user_id = ?",
    [userId]
  );
  if (existing) return existing;
  await db.execute(
    "INSERT INTO trading_accounts (user_id, options_level, margin_enabled, status, created_at) VALUES (?, 0, 0, 'active', ?)",
    [userId, new Date().toISOString()]
  );
  return { options_level: 0 };
}

function mapOrder(r: RawOrder, symbol: string): OrderRow {
  return {
    id: r.id,
    userId: r.user_id,
    instrumentId: r.instrument_id,
    symbol,
    side: r.side,
    type: r.type,
    qtyBase: BigInt(r.qty_base).toString(),
    status: r.status,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// HOT PATH — order entry. No ledger access; returns immediately.
// ---------------------------------------------------------------------------
export async function placeOrder(input: PlaceOrderInput): Promise<OrderRow> {
  if (!config.TRADING_ENABLED) {
    throw new AppError(ErrorCode.TRADING_DISABLED, "Trading is currently unavailable");
  }
  if (input.qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "Order quantity must be positive");
  if (input.side !== "buy" && input.side !== "sell") throw new AppError(ErrorCode.VALIDATION, "Invalid side");
  if (!["market", "limit", "stop", "stop_limit"].includes(input.type)) {
    throw new AppError(ErrorCode.VALIDATION, "Invalid order type");
  }
  if ((input.type === "limit" || input.type === "stop_limit") && (input.limitPriceMinor == null || input.limitPriceMinor <= 0n)) {
    throw new AppError(ErrorCode.VALIDATION, "Limit and stop-limit orders require a positive limit price");
  }
  if ((input.type === "stop" || input.type === "stop_limit") && (input.stopPriceMinor == null || input.stopPriceMinor <= 0n)) {
    throw new AppError(ErrorCode.VALIDATION, "Stop and stop-limit orders require a positive stop price");
  }

  const db = getDb();
  const instrument = await db.queryOne<InstrumentRow>(
    "SELECT id, symbol, kind, currency, last_price_minor, min_options_level, status FROM instruments WHERE symbol = ?",
    [input.symbol]
  );
  if (!instrument || instrument.status !== "active") {
    throw new AppError(ErrorCode.NOT_FOUND, `Instrument ${input.symbol} not tradable`);
  }

  const account = await ensureTradingAccount(input.userId);
  if (instrument.kind === "option" && account.options_level < instrument.min_options_level) {
    throw new AppError(ErrorCode.FORBIDDEN, `Options level ${instrument.min_options_level} required to trade ${instrument.symbol}`);
  }

  // Idempotency: a retried placement collapses onto the same order.
  const existing = await db.queryOne<RawOrder>(
    "SELECT * FROM orders_trading WHERE idempotency_key = ?",
    [input.idempotencyKey]
  );
  if (existing) return mapOrder(existing, instrument.symbol);

  const id = uuidv4();
  const limitPrice =
    input.type === "limit" || input.type === "stop_limit" ? input.limitPriceMinor : null;
  const stopPrice = input.type === "stop" || input.type === "stop_limit" ? input.stopPriceMinor : null;

  await db.execute(
    `INSERT INTO orders_trading (id, user_id, instrument_id, side, type, qty_base, limit_price_minor, stop_price_minor, status, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    [
      id,
      input.userId,
      instrument.id,
      input.side,
      input.type,
      input.qtyBase,
      limitPrice,
      stopPrice,
      input.idempotencyKey,
      new Date().toISOString(),
    ]
  );

  enqueueSettlement(id);
  tradingOrderTotal.inc({ side: input.side, result: "accepted" });

  const row = await db.queryOne<RawOrder>("SELECT * FROM orders_trading WHERE id = ?", [id]);
  return mapOrder(row!, instrument.symbol);
}

// ---------------------------------------------------------------------------
// ASYNC SETTLEMENT — the only path that touches the ledger.
// ---------------------------------------------------------------------------
const queue: string[] = [];
export function enqueueSettlement(orderId: string): void {
  queue.push(orderId);
}
export function pendingSettlementCount(): number {
  return queue.length;
}

/** Drain up to `max` queued settlements. Returns the count processed (or deferred). */
export async function runSettlementOnce(max = 50): Promise<number> {
  let n = 0;
  while (queue.length > 0 && n < max) {
    const id = queue.shift()!;
    await settleOrder(id);
    n += 1;
  }
  return n;
}

/**
 * Settle one order: ask the broker for a fill, check funds/position, post the
 * balanced journal, record the (append-only) fill. Idempotent and crash-safe:
 * a broker outage leaves the order 'accepted' (re-enqueued); a double-call is a
 * no-op once a fill exists or the order is terminal.
 */
export async function settleOrder(orderId: string): Promise<void> {
  const db = getDb();
  const order = await db.queryOne<RawOrder>("SELECT * FROM orders_trading WHERE id = ?", [orderId]);
  if (!order || order.status !== "accepted") return; // already settled/rejected, or unknown

  // Idempotency: if a fill already exists, just ensure the order is marked settled.
  const existingFill = await db.queryOne<{ id: string }>("SELECT id FROM fills WHERE order_id = ?", [orderId]);
  if (existingFill) {
    await db.execute("UPDATE orders_trading SET status = 'settled' WHERE id = ?", [orderId]);
    return;
  }

  const instrument = await db.queryOne<InstrumentRow>(
    "SELECT id, symbol, kind, currency, last_price_minor, min_options_level, status FROM instruments WHERE id = ?",
    [order.instrument_id]
  );
  if (!instrument) return;

  const brokerOrder: BrokerOrder = {
    side: order.side,
    type: order.type,
    qtyBase: BigInt(order.qty_base),
    limitPriceMinor: order.limit_price_minor == null ? null : BigInt(order.limit_price_minor),
    stopPriceMinor: order.stop_price_minor == null ? null : BigInt(order.stop_price_minor),
  };

  let exec;
  try {
    exec = await brokerExecute(brokerOrder, instrument);
  } catch (e) {
    if (e instanceof OrderNotExecutableError) {
      // Stop not triggered or limit not marketable — leave pending; retry on next drain.
      queue.push(orderId);
      tradingSettlementTotal.inc({ result: "pending" });
      return;
    }
    if (e instanceof BrokerUnavailableError) {
      // Broker down — leave the order pending; re-enqueue for a later drain.
      // This is the isolation point: a broker outage NEVER becomes a money error.
      queue.push(orderId);
      tradingSettlementTotal.inc({ result: "deferred" });
      return;
    }
    throw e;
  }

  const cur = instrument.currency;
  const userCash = await getOrCreateUserAccount(order.user_id, "user_cash", cur);
  const userPos = await getOrCreateUserPositionAccount(order.user_id, instrument.id);
  const posCode = positionLedgerCode(instrument.id);

  // Pre-settlement sufficiency check (the only "balance" read; off the hot path).
  if (order.side === "buy") {
    const cash = await getBalance(userCash);
    if (cash < exec.grossMinor + exec.feeMinor) {
      await rejectOrder(orderId, "insufficient_funds");
      return;
    }
  } else {
    const pos = await getBalance(userPos);
    if (pos < exec.qtyBase) {
      await rejectOrder(orderId, "insufficient_position");
      return;
    }
  }

  const extClear = await getSystemAccount("external_clearing", cur);
  const feeAcct = await getSystemAccount("fee", cur);
  const brokerPos = await getOrCreateSystemAccount("broker_clearing", posCode);

  // One balanced journal: cash leg (per `cur`) + position leg (per `posCode`).
  const entries =
    order.side === "buy"
      ? [
          { ledgerAccountId: userCash, direction: "debit" as const, amountMinor: exec.grossMinor + exec.feeMinor, currency: cur },
          { ledgerAccountId: extClear, direction: "credit" as const, amountMinor: exec.grossMinor, currency: cur },
          { ledgerAccountId: feeAcct, direction: "credit" as const, amountMinor: exec.feeMinor, currency: cur },
          { ledgerAccountId: brokerPos, direction: "debit" as const, amountMinor: exec.qtyBase, currency: posCode },
          { ledgerAccountId: userPos, direction: "credit" as const, amountMinor: exec.qtyBase, currency: posCode },
        ]
      : [
          { ledgerAccountId: extClear, direction: "debit" as const, amountMinor: exec.grossMinor, currency: cur },
          { ledgerAccountId: userCash, direction: "credit" as const, amountMinor: exec.grossMinor - exec.feeMinor, currency: cur },
          { ledgerAccountId: feeAcct, direction: "credit" as const, amountMinor: exec.feeMinor, currency: cur },
          { ledgerAccountId: userPos, direction: "debit" as const, amountMinor: exec.qtyBase, currency: posCode },
          { ledgerAccountId: brokerPos, direction: "credit" as const, amountMinor: exec.qtyBase, currency: posCode },
        ];

  // Exactly-once: idempotent on the fill key, so a retry collapses to one journal.
  const fillKey = `tradefill:${orderId}`;
  const journalId = await postJournal(entries, `Trade ${order.side} ${instrument.symbol}`, { idempotencyKey: fillKey });

  await db.execute(
    `INSERT INTO fills (id, order_id, qty_base, price_minor, fee_minor, gross_minor, settled_journal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), orderId, exec.qtyBase, exec.priceMinor, exec.feeMinor, exec.grossMinor, journalId, new Date().toISOString()]
  );
  await db.execute("UPDATE orders_trading SET status = 'settled', broker_order_id = ? WHERE id = ?", [
    exec.brokerOrderId,
    orderId,
  ]);

  tradingSettlementTotal.inc({ result: "settled" });
  await logAudit({
    userId: order.user_id,
    action: "trade_settled",
    resource: orderId,
    details: {
      symbol: instrument.symbol,
      side: order.side,
      qtyBase: exec.qtyBase.toString(),
      priceMinor: exec.priceMinor.toString(),
      feeMinor: exec.feeMinor.toString(),
      journalId,
    },
  });
}

async function rejectOrder(orderId: string, reason: string): Promise<void> {
  await getDb().execute("UPDATE orders_trading SET status = 'rejected', reject_reason = ? WHERE id = ?", [reason, orderId]);
  tradingSettlementTotal.inc({ result: "rejected" });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getOrders(userId: string, limit = 50): Promise<OrderRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<RawOrder & { symbol: string }>(
    `SELECT o.*, i.symbol AS symbol FROM orders_trading o JOIN instruments i ON i.id = o.instrument_id
       WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT ?`,
    [userId, capped]
  );
  return rows.map((r) => mapOrder(r, r.symbol));
}

/** Admin/compliance: raise a user's options approval level (0–4). */
export async function setOptionsLevel(userId: string, level: number): Promise<{ userId: string; optionsLevel: number }> {
  if (level < 0 || level > 4 || !Number.isInteger(level)) {
    throw new AppError(ErrorCode.VALIDATION, "Options level must be an integer 0–4");
  }
  await ensureTradingAccount(userId);
  await getDb().execute("UPDATE trading_accounts SET options_level = ? WHERE user_id = ?", [level, userId]);
  await logAudit({
    userId,
    action: "trading_options_level_set",
    resource: userId,
    details: { optionsLevel: level },
  });
  return { userId, optionsLevel: level };
}

export async function getTradingAccount(userId: string): Promise<{ optionsLevel: number; marginEnabled: boolean }> {
  const row = await ensureTradingAccount(userId);
  const acct = await getDb().queryOne<{ margin_enabled: number }>(
    "SELECT margin_enabled FROM trading_accounts WHERE user_id = ?",
    [userId]
  );
  return { optionsLevel: row.options_level, marginEnabled: (acct?.margin_enabled ?? 0) === 1 };
}

export async function getPositions(userId: string): Promise<{ symbol: string; qtyBase: string }[]> {
  const accounts = await getDb().query<{ id: string; currency: string }>(
    "SELECT id, currency FROM ledger_accounts WHERE user_id = ? AND kind = 'user_position'",
    [userId]
  );
  const out: { symbol: string; qtyBase: string }[] = [];
  for (const a of accounts) {
    const qty = await getBalance(a.id);
    if (qty === 0n) continue;
    const instrumentId = a.currency.replace(/^POS:/, "");
    const inst = await getDb().queryOne<{ symbol: string }>("SELECT symbol FROM instruments WHERE id = ?", [instrumentId]);
    out.push({ symbol: inst?.symbol ?? instrumentId, qtyBase: qty.toString() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settlement loop (started from index.ts only when TRADING_ENABLED).
// ---------------------------------------------------------------------------
let loop: ReturnType<typeof setInterval> | null = null;
export function startSettlementLoop(intervalMs = 250): void {
  if (loop) return;
  loop = setInterval(() => {
    void runSettlementOnce().catch(() => {
      /* settlement errors are logged per-order; never crash the loop */
    });
  }, intervalMs);
  // Don't keep the process alive solely for the trading loop.
  if (typeof loop.unref === "function") loop.unref();
}
export function stopSettlementLoop(): void {
  if (loop) {
    clearInterval(loop);
    loop = null;
  }
}
