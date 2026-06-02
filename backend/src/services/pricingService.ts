/**
 * Phase 8 — Pricing & discovery.
 *
 * Surfaces the current price for an asset from its latest listing version, with
 * the price SOURCE and AS-OF timestamp always attached, plus a staleness flag
 * computed against per-source thresholds (REQ-MK-PRICE-001/002). Also a basic
 * wash-trade signal on market-priced listings (REQ-MK-PRICE-003).
 *
 * In this prototype the listing price is issuer/admin published (a NAV feed or a
 * spot feed is simulated upstream); a live Chainlink-shaped oracle is a later item.
 */

import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";

export type PriceSource = "nav" | "spot" | "orderbook" | "issuer";

// Max age before a price is considered stale, by source (ms).
const STALENESS_MS: Record<PriceSource, number> = {
  spot: 5 * 60 * 1000, // 5 minutes
  orderbook: 60 * 60 * 1000, // 1 hour
  nav: 24 * 60 * 60 * 1000, // 1 day
  issuer: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export interface PriceQuote {
  priceMinor: bigint;
  currency: string;
  source: PriceSource;
  asOf: string;
  stale: boolean;
}

interface ListingPriceRow {
  price_minor: number | string;
  currency: string;
  price_source: PriceSource;
  price_as_of: string;
  status: string;
}

/** The current (latest version) listing price for an asset, with staleness. */
export async function getCurrentPrice(assetId: string): Promise<PriceQuote> {
  const row = await getDb().queryOne<ListingPriceRow>(
    "SELECT price_minor, currency, price_source, price_as_of, status FROM listings WHERE asset_id = ? ORDER BY version DESC LIMIT 1",
    [assetId]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Asset is not listed");

  const ageMs = Date.now() - new Date(row.price_as_of).getTime();
  const threshold = STALENESS_MS[row.price_source] ?? STALENESS_MS.issuer;
  return {
    priceMinor: BigInt(row.price_minor),
    currency: row.currency,
    source: row.price_source,
    asOf: row.price_as_of,
    stale: ageMs > threshold,
  };
}

/**
 * Basic wash-trade signal: the same user both bought and sold this asset within
 * a short window. Advisory only — returned to the caller; not a hard block.
 */
export async function detectWashTrade(assetId: string, userId: string, windowMs = 10 * 60 * 1000): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const rows = await getDb().query<{ side: string }>(
    "SELECT DISTINCT side FROM orders WHERE asset_id = ? AND user_id = ? AND status = 'filled' AND created_at >= ?",
    [assetId, userId, since]
  );
  const sides = new Set(rows.map((r) => r.side));
  return sides.has("buy") && sides.has("sell");
}
