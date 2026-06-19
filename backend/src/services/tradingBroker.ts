/**
 * Phase 17 — Simulated broker + market data, behind a circuit breaker.
 *
 * Stage 1: basic market/limit execution.
 * Stage 2: stop/stop_limit triggers, limit marketability, quotes via marketDataService.
 *
 * This is the anti-corruption-layer stand-in for a real broker-dealer/clearing +
 * market-data partner (docs/PHASE-17-TRADING-BROKERAGE.md §6, §9).
 */

import { getQuote, type InstrumentRef } from "./marketDataService";

export type InstrumentLike = InstrumentRef;

export interface BrokerOrder {
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  qtyBase: bigint;
  limitPriceMinor: bigint | null;
  stopPriceMinor: bigint | null;
}

export interface ExecutionResult {
  qtyBase: bigint;
  priceMinor: bigint;
  feeMinor: bigint;
  grossMinor: bigint;
  brokerOrderId: string;
}

/** Order not yet executable (stop not triggered, limit not marketable) — re-queue, not an error. */
export class OrderNotExecutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderNotExecutableError";
  }
}

/** Thrown when the broker/circuit is unavailable — NOT a money error. */
export class BrokerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerUnavailableError";
  }
}

/** Simulated commission: 10 bps of gross, floored at 1 minor unit. */
const FEE_BPS = 10n;
function feeFor(grossMinor: bigint): bigint {
  const fee = (grossMinor * FEE_BPS) / 10_000n;
  return fee > 0n ? fee : 1n;
}

// ---------------------------------------------------------------------------
// Test / fault-injection hooks.
// ---------------------------------------------------------------------------
type BrokerMode = "ok" | "fail" | "stall";
let mode: BrokerMode = "ok";
let stallMs = 0;

export function __setBrokerMode(m: BrokerMode, opts?: { stallMs?: number }): void {
  mode = m;
  stallMs = opts?.stallMs ?? 0;
}
export function __resetBroker(): void {
  mode = "ok";
  stallMs = 0;
  failures = 0;
  openedAt = null;
}

// ---------------------------------------------------------------------------
// Minimal circuit breaker.
// ---------------------------------------------------------------------------
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;
let failures = 0;
let openedAt: number | null = null;

export function breakerOpen(): boolean {
  if (openedAt == null) return false;
  if (Date.now() - openedAt >= COOLDOWN_MS) {
    openedAt = null;
    failures = 0;
    return false;
  }
  return true;
}

function recordFailure(): void {
  failures += 1;
  if (failures >= FAILURE_THRESHOLD) openedAt = Date.now();
}
function recordSuccess(): void {
  failures = 0;
  openedAt = null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stopTriggered(order: BrokerOrder, last: bigint): boolean {
  if (order.type !== "stop" && order.type !== "stop_limit") return true;
  const stop = order.stopPriceMinor;
  if (stop == null) return false;
  if (order.side === "buy") return last >= stop;
  return last <= stop;
}

function limitMarketable(order: BrokerOrder, last: bigint): boolean {
  if (order.type !== "limit" && order.type !== "stop_limit") return true;
  const limit = order.limitPriceMinor;
  if (limit == null) return false;
  if (order.side === "buy") return last <= limit;
  return last >= limit;
}

function fillPrice(order: BrokerOrder, last: bigint): bigint {
  if (order.type === "market" || order.type === "stop") return last;
  if (order.type === "limit" || order.type === "stop_limit") {
    return order.limitPriceMinor ?? last;
  }
  return last;
}

let brokerSeq = 0;

/**
 * Execute an order against the simulated broker. Async (non-blocking), breaker-guarded.
 * Throws OrderNotExecutableError when stop/limit conditions aren't met (order stays pending).
 * Throws BrokerUnavailableError when the broker is unhealthy.
 */
export async function execute(order: BrokerOrder, instrument: InstrumentLike): Promise<ExecutionResult> {
  if (breakerOpen()) {
    throw new BrokerUnavailableError("circuit open");
  }

  if (mode === "stall" && stallMs > 0) await sleep(stallMs);

  if (mode === "fail") {
    recordFailure();
    throw new BrokerUnavailableError("simulated broker failure");
  }

  recordSuccess();

  const quote = await getQuote(instrument);
  const last = quote.lastMinor;

  if (!stopTriggered(order, last)) {
    throw new OrderNotExecutableError("stop not triggered");
  }

  const effectiveType =
    order.type === "stop" ? "market" : order.type === "stop_limit" ? "limit" : order.type;

  if (!limitMarketable({ ...order, type: effectiveType }, last)) {
    throw new OrderNotExecutableError("limit not marketable");
  }

  const priceMinor = fillPrice({ ...order, type: effectiveType }, last);
  const grossMinor = order.qtyBase * priceMinor;
  return {
    qtyBase: order.qtyBase,
    priceMinor,
    feeMinor: feeFor(grossMinor),
    grossMinor,
    brokerOrderId: `sim-${++brokerSeq}-${order.side}`,
  };
}

/** @deprecated Use marketDataService.getQuote — kept for tests that import getQuote from broker. */
export function getQuoteLegacy(instrument: InstrumentLike): { instrumentId: string; priceMinor: bigint } {
  return { instrumentId: instrument.id, priceMinor: BigInt(instrument.last_price_minor) };
}
