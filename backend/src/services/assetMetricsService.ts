/**
 * Phase 30 — Asset metrics. Composes the investment signals for an asset from data
 * that already exists (ledger holders, listing price history, fills, distributions)
 * plus the watchlist/view/valuation seams. Read-only; no money mutation.
 *
 * Compliance: valuation is a labeled REFERENCE signal and yield is TRAILING/historical
 * — never a forecast or recommendation. The route/UI carry the not-advice disclaimer.
 */
import { getDb } from "../db";
import { getAsset, type Asset } from "./tokenizationService";
import { getAssetHolderCount, getAssetBalance } from "./ledgerService";
import * as watchlist from "./watchlistService";
import * as views from "./assetViewService";
import { valuate, type Valuation } from "./marketValuationService";
import { getCostBasis, type CostBasis } from "./costBasisService";
import { assetMetricsRequestTotal } from "../observability/metrics";

export interface PricePoint {
  priceMinor: string;
  asOf: string;
}
export interface TradeStats {
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  totalVolumeMinor: string;
  lastTradeAt: string | null;
}
export interface YieldInfo {
  apyBps: number | null;
  trailingYieldBps: number | null;
  lastDistribution: { amountPerUnitMinor: string; currency: string; payDate: string } | null;
}
export interface AssetMetrics {
  assetId: string;
  priceMinor: string | null;
  currency: string;
  priceSource: string | null;
  stale: boolean;
  priceChangeBps: number | null;
  priceHistory: PricePoint[];
  investorCount: number;
  saverCount: number;
  viewerCount: number;
  isWatched: boolean;
  tradeStats: TradeStats;
  yield: YieldInfo;
  valuation: Valuation | null;
  costPerUnitMinor: string | null;
  decimals: number;
  position: { heldQtyBase: string; costBasis: CostBasis } | null;
}

export interface CompactMetrics {
  investorCount: number;
  saverCount: number;
  priceChangeBps: number | null;
  yieldApyBps: number | null;
  isWatched: boolean;
}

async function priceHistory(assetId: string): Promise<PricePoint[]> {
  const rows = await getDb().query<{ price_minor: string | number; price_as_of: string }>(
    "SELECT price_minor, price_as_of FROM listings WHERE asset_id = ? ORDER BY version ASC",
    [assetId]
  );
  return rows.map((r) => ({ priceMinor: String(r.price_minor), asOf: r.price_as_of }));
}

function changeBps(history: PricePoint[]): number | null {
  if (history.length < 2) return null;
  const prev = BigInt(history[history.length - 2]!.priceMinor);
  const last = BigInt(history[history.length - 1]!.priceMinor);
  if (prev <= 0n) return null;
  return Number(((last - prev) * 10000n) / prev);
}

/** Buy/sell counts + volume, unioning primary orders, secondary trades, collectible purchases. */
export async function listTradeStats(assetId: string): Promise<TradeStats> {
  const db = getDb();
  let buyCount = 0;
  let sellCount = 0;
  let tradeCount = 0;
  let volume = 0n;
  let lastTradeAt: string | null = null;
  const bump = (at: string | null) => {
    if (at && (!lastTradeAt || at > lastTradeAt)) lastTradeAt = at;
  };

  const orders = await db.query<{ side: string; c: number; vol: string | number | null; last: string | null }>(
    "SELECT side, COUNT(*) AS c, SUM(gross_minor) AS vol, MAX(created_at) AS last FROM orders WHERE asset_id = ? AND status = 'filled' GROUP BY side",
    [assetId]
  );
  for (const o of orders) {
    if (o.side === "buy") buyCount += Number(o.c);
    else if (o.side === "sell") sellCount += Number(o.c);
    tradeCount += Number(o.c);
    volume += BigInt(o.vol ?? 0);
    bump(o.last);
  }

  const trades = await db.query<{ qty: string; price_minor: string; created_at: string }>(
    "SELECT qty, price_minor, created_at FROM trades WHERE asset_id = ?",
    [assetId]
  );
  for (const t of trades) {
    buyCount += 1;
    sellCount += 1;
    tradeCount += 1;
    volume += BigInt(t.qty) * BigInt(t.price_minor);
    bump(t.created_at);
  }

  const purchases = await db.query<{ amount_minor: string; created_at: string }>(
    "SELECT amount_minor, created_at FROM collectible_purchases WHERE asset_id = ? AND status IN ('shipped','completed')",
    [assetId]
  );
  for (const p of purchases) {
    buyCount += 1;
    tradeCount += 1;
    volume += BigInt(p.amount_minor);
    bump(p.created_at);
  }

  return { buyCount, sellCount, tradeCount, totalVolumeMinor: volume.toString(), lastTradeAt };
}

async function computeYield(asset: Asset, priceMinor: bigint | null): Promise<YieldInfo> {
  const apyBps = typeof asset.metadata.apyBps === "number" ? asset.metadata.apyBps : null;

  const last = await getDb().queryOne<{ amount_per_unit_minor: string; currency: string; pay_date: string }>(
    "SELECT amount_per_unit_minor, currency, pay_date FROM corporate_actions WHERE asset_id = ? AND type = 'dividend' ORDER BY pay_date DESC LIMIT 1",
    [asset.id]
  );
  const lastDistribution = last
    ? { amountPerUnitMinor: last.amount_per_unit_minor, currency: last.currency, payDate: last.pay_date }
    : null;

  let trailingYieldBps: number | null = null;
  if (priceMinor && priceMinor > 0n) {
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const sum = await getDb().queryOne<{ total: string | number | null }>(
      "SELECT SUM(amount_per_unit_minor) AS total FROM corporate_actions WHERE asset_id = ? AND type = 'dividend' AND pay_date >= ?",
      [asset.id, since]
    );
    const trailing = BigInt(sum?.total ?? 0);
    if (trailing > 0n) trailingYieldBps = Number((trailing * 10000n) / priceMinor);
  }

  return { apyBps, trailingYieldBps, lastDistribution };
}

export async function getMetrics(assetId: string, userId?: string): Promise<AssetMetrics | null> {
  const asset = await getAsset(assetId);
  if (!asset) return null;
  assetMetricsRequestTotal.inc();

  const listing = await getDb().queryOne<{ price_minor: string | number; currency: string; price_source: string }>(
    "SELECT price_minor, currency, price_source FROM listings WHERE asset_id = ? ORDER BY version DESC LIMIT 1",
    [assetId]
  );
  const priceMinor = listing ? BigInt(listing.price_minor) : null;
  const currency = listing?.currency ?? "USD";

  const history = await priceHistory(assetId);

  const [investorCount, saverCount, viewerCount, isWatched, tradeStats, yieldInfo] = await Promise.all([
    getAssetHolderCount(assetId),
    watchlist.countForAsset(assetId),
    views.distinctViewers(assetId),
    userId ? watchlist.isWatched(userId, assetId) : Promise.resolve(false),
    listTradeStats(assetId),
    computeYield(asset, priceMinor),
  ]);

  const valuation = priceMinor
    ? await valuate({ assetId, kind: asset.kind, metadata: asset.metadata, priceMinor, currency })
    : null;

  let position: AssetMetrics["position"] = null;
  if (userId) {
    const heldQty = await getAssetBalance(userId, assetId);
    if (heldQty > 0n || history.length > 0) {
      const costBasis = await getCostBasis(userId, assetId, heldQty, priceMinor);
      position = { heldQtyBase: heldQty.toString(), costBasis };
    }
  }

  return {
    assetId,
    priceMinor: priceMinor ? priceMinor.toString() : null,
    currency,
    priceSource: listing?.price_source ?? null,
    stale: false,
    priceChangeBps: changeBps(history),
    priceHistory: history,
    investorCount,
    saverCount,
    viewerCount,
    isWatched,
    tradeStats,
    yield: yieldInfo,
    valuation,
    costPerUnitMinor: priceMinor ? priceMinor.toString() : null,
    decimals: asset.decimals,
    position,
  };
}

/** Compact metrics for a page of listing cards — batched, no N+1 on the heavy joins. */
export async function listMetricsForSurface(
  assetIds: string[],
  userId?: string
): Promise<Record<string, CompactMetrics>> {
  if (assetIds.length === 0) return {};
  const db = getDb();
  const placeholders = assetIds.map(() => "?").join(",");

  // Price history (all versions) for change%; metadata for apyBps — one query each.
  const histRows = await db.query<{ asset_id: string; price_minor: string | number; version: number }>(
    `SELECT asset_id, price_minor, version FROM listings WHERE asset_id IN (${placeholders}) ORDER BY asset_id, version`,
    assetIds
  );
  const byAsset: Record<string, PricePoint[]> = {};
  for (const r of histRows) {
    (byAsset[r.asset_id] ??= []).push({ priceMinor: String(r.price_minor), asOf: "" });
  }

  const metaRows = await db.query<{ id: string; metadata: string | null }>(
    `SELECT id, metadata FROM assets WHERE id IN (${placeholders})`,
    assetIds
  );
  const apyByAsset: Record<string, number | null> = {};
  for (const r of metaRows) {
    try {
      const m = JSON.parse(r.metadata ?? "{}") as Record<string, unknown>;
      apyByAsset[r.id] = typeof m.apyBps === "number" ? m.apyBps : null;
    } catch {
      apyByAsset[r.id] = null;
    }
  }

  const [saverCounts, watched, investorCounts] = await Promise.all([
    watchlist.countsForAssets(assetIds),
    userId ? watchlist.watchedSet(userId, assetIds) : Promise.resolve(new Set<string>()),
    Promise.all(assetIds.map((id) => getAssetHolderCount(id))),
  ]);

  const out: Record<string, CompactMetrics> = {};
  assetIds.forEach((id, i) => {
    out[id] = {
      investorCount: investorCounts[i] ?? 0,
      saverCount: saverCounts[id] ?? 0,
      priceChangeBps: changeBps(byAsset[id] ?? []),
      yieldApyBps: apyByAsset[id] ?? null,
      isWatched: watched.has(id),
    };
  });
  return out;
}
