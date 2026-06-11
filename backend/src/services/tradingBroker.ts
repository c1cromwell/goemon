/**
 * Phase 17 Stage 1 — Simulated broker + market data, behind a circuit breaker.
 *
 * This is the anti-corruption-layer stand-in for a real broker-dealer/clearing +
 * market-data partner (docs/PHASE-17-TRADING-BROKERAGE.md §6, §9). It is the ONLY
 * place that "talks to the market"; the rest of trading depends on this narrow
 * interface, so a real partner later implements the same shape.
 *
 * SLA isolation: every call is async (yields the event loop — a slow broker never
 * blocks the bank's money path) and guarded by a circuit breaker that fast-fails
 * once the broker is unhealthy, so a broker outage cannot back up into shared
 * resources. The settlement worker treats a BrokerUnavailable as "leave the order
 * pending", never as a money error.
 */

export interface InstrumentLike {
  id: string;
  symbol: string;
  last_price_minor: number | string;
}

export interface Quote {
  instrumentId: string;
  priceMinor: bigint;
}

export interface BrokerOrder {
  side: "buy" | "sell";
  type: "market" | "limit";
  qtyBase: bigint;
  limitPriceMinor: bigint | null;
}

export interface ExecutionResult {
  qtyBase: bigint;
  priceMinor: bigint;
  feeMinor: bigint;
  grossMinor: bigint;
  brokerOrderId: string;
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
// Test / fault-injection hooks (Stage 1 only — drives the isolation tests).
// ---------------------------------------------------------------------------
type BrokerMode = "ok" | "fail" | "stall";
let mode: BrokerMode = "ok";
let stallMs = 0;

/** Force the simulated broker into a fault mode (tests). */
export function __setBrokerMode(m: BrokerMode, opts?: { stallMs?: number }): void {
  mode = m;
  stallMs = opts?.stallMs ?? 0;
}
/** Reset broker + breaker to healthy (tests). */
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
    // half-open: allow a probe through
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

/** Deterministic mark for an instrument (simulated market data). */
export function getQuote(instrument: InstrumentLike): Quote {
  return { instrumentId: instrument.id, priceMinor: BigInt(instrument.last_price_minor) };
}

let brokerSeq = 0;

/**
 * Execute an order against the simulated broker. Async (non-blocking), breaker-guarded.
 * Throws BrokerUnavailableError when the broker is unhealthy — the caller leaves the
 * order pending; it is never turned into a money mutation.
 */
export async function execute(order: BrokerOrder, instrument: InstrumentLike): Promise<ExecutionResult> {
  if (breakerOpen()) {
    throw new BrokerUnavailableError("circuit open");
  }

  // A slow broker yields the event loop — the bank's money path runs concurrently.
  if (mode === "stall" && stallMs > 0) await sleep(stallMs);

  if (mode === "fail") {
    recordFailure();
    throw new BrokerUnavailableError("simulated broker failure");
  }

  recordSuccess();

  // Market orders fill at the quote; limit orders fill at the limit (already validated marketable).
  const quote = getQuote(instrument);
  const priceMinor = order.type === "limit" && order.limitPriceMinor != null ? order.limitPriceMinor : quote.priceMinor;
  const grossMinor = order.qtyBase * priceMinor;
  return {
    qtyBase: order.qtyBase,
    priceMinor,
    feeMinor: feeFor(grossMinor),
    grossMinor,
    brokerOrderId: `sim-${++brokerSeq}-${order.side}`,
  };
}
