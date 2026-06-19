/**
 * Phase 17 Stage 2 — Market-data seam (CQRS read path).
 *
 * Swappable provider for level-1 quotes (bid/ask/last) with source, as-of, and
 * staleness — separate from the ledger and off the order hot path. Snapshots are
 * cached append-only for analytics/history; settlement reads the latest quote via
 * this service, never from `instruments.last_price_minor` directly.
 *
 * Providers: simulated (default, offline) | polygon | iex (NOT_IMPLEMENTED stubs).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { marketDataQuoteTotal } from "../observability/metrics";

export type MarketDataSource = "simulated" | "polygon" | "iex";

export interface InstrumentRef {
  id: string;
  symbol: string;
  last_price_minor: number | string;
}

export interface MarketQuote {
  instrumentId: string;
  symbol: string;
  bidMinor: bigint;
  askMinor: bigint;
  lastMinor: bigint;
  source: MarketDataSource;
  asOf: string;
  stale: boolean;
}

export interface MarketDataProvider {
  name: MarketDataSource;
  fetchQuote(instrument: InstrumentRef): Promise<Omit<MarketQuote, "instrumentId" | "symbol">>;
}

const STALENESS_MS: Record<MarketDataSource, number> = {
  simulated: 60_000,
  polygon: 5 * 60_000,
  iex: 5 * 60_000,
};

/** Simulated spread: 1 tick each side of last (integer minor units). */
const SIM_SPREAD_TICK = 1n;

function simulatedProvider(): MarketDataProvider {
  return {
    name: "simulated",
    async fetchQuote(instrument) {
      const last = BigInt(instrument.last_price_minor);
      const asOf = new Date().toISOString();
      return {
        bidMinor: last > SIM_SPREAD_TICK ? last - SIM_SPREAD_TICK : last,
        askMinor: last + SIM_SPREAD_TICK,
        lastMinor: last,
        source: "simulated" as const,
        asOf,
        stale: false,
      };
    },
  };
}

function notImplemented(name: MarketDataSource): MarketDataProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `MARKET_DATA_PROVIDER=${name} is not wired in this prototype — integrate a licensed market-data feed`
    );
  };
  return { name, fetchQuote: fail };
}

let provider: MarketDataProvider | null = null;
export function setMarketDataProvider(p: MarketDataProvider | null): void {
  provider = p;
}

export function getMarketDataProvider(): MarketDataProvider {
  if (provider) return provider;
  switch (config.MARKET_DATA_PROVIDER) {
    case "polygon":
      return notImplemented("polygon");
    case "iex":
      return notImplemented("iex");
    default:
      return simulatedProvider();
  }
}

async function cacheSnapshot(instrumentId: string, q: MarketQuote): Promise<void> {
  await getDb().execute(
    `INSERT INTO market_data_snapshots (id, instrument_id, bid_minor, ask_minor, last_minor, source, as_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      instrumentId,
      q.bidMinor,
      q.askMinor,
      q.lastMinor,
      q.source,
      q.asOf,
      new Date().toISOString(),
    ]
  );
}

function withStaleness(q: Omit<MarketQuote, "instrumentId" | "symbol" | "stale">): { stale: boolean } {
  const ageMs = Date.now() - new Date(q.asOf).getTime();
  const threshold = STALENESS_MS[q.source] ?? STALENESS_MS.simulated;
  return { stale: ageMs > threshold };
}

/** Fetch a live quote for one instrument; caches an append-only snapshot. */
export async function getQuote(instrument: InstrumentRef): Promise<MarketQuote> {
  const raw = await getMarketDataProvider().fetchQuote(instrument);
  const quote: MarketQuote = {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    ...raw,
    ...withStaleness(raw),
  };
  await cacheSnapshot(instrument.id, quote);
  marketDataQuoteTotal.inc({ source: quote.source, stale: quote.stale ? "true" : "false" });
  return quote;
}

/** Batch quotes for active instruments (display / discovery). */
export async function getQuotes(symbols?: string[]): Promise<MarketQuote[]> {
  const db = getDb();
  const rows = symbols?.length
    ? await db.query<InstrumentRef>(
        "SELECT id, symbol, last_price_minor FROM instruments WHERE status = 'active' AND symbol IN (" +
          symbols.map(() => "?").join(",") +
          ") ORDER BY symbol",
        symbols
      )
    : await db.query<InstrumentRef>(
        "SELECT id, symbol, last_price_minor FROM instruments WHERE status = 'active' ORDER BY symbol"
      );
  const out: MarketQuote[] = [];
  for (const r of rows) out.push(await getQuote(r));
  return out;
}

/** Latest cached snapshot per instrument (read-only CQRS; no provider call). */
export async function getLatestSnapshots(limit = 20): Promise<MarketQuote[]> {
  const rows = await getDb().query<{
    instrument_id: string;
    symbol: string;
    bid_minor: string | number;
    ask_minor: string | number;
    last_minor: string | number;
    source: MarketDataSource;
    as_of: string;
  }>(
    `SELECT s.instrument_id, i.symbol, s.bid_minor, s.ask_minor, s.last_minor, s.source, s.as_of
       FROM market_data_snapshots s
       JOIN instruments i ON i.id = s.instrument_id
       WHERE s.created_at = (
         SELECT MAX(s2.created_at) FROM market_data_snapshots s2 WHERE s2.instrument_id = s.instrument_id
       )
       ORDER BY i.symbol LIMIT ?`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => {
    const partial = {
      bidMinor: BigInt(r.bid_minor),
      askMinor: BigInt(r.ask_minor),
      lastMinor: BigInt(r.last_minor),
      source: r.source,
      asOf: r.as_of,
    };
    return {
      instrumentId: r.instrument_id,
      symbol: r.symbol,
      ...partial,
      ...withStaleness(partial),
    };
  });
}
