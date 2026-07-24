/**
 * Phase 30 — Cost basis + P&L, derived from a user's buy fills (no new table).
 *
 * Weighted-average cost from primary-market `orders` (side='buy', filled) and
 * secondary-market `trades` (buyer). Unrealized P&L = heldQty × (price − avgCost).
 * Returns null cost fields when we have no recorded buys (e.g. seeded holdings) —
 * we never fabricate a basis. Illustrative, not tax advice.
 */
import { getDb } from "../db";

export interface CostBasis {
  avgCostPerUnitMinor: string | null;
  costBasisMinor: string | null; // avgCost × heldQty (basis of the current position)
  unrealizedPnlMinor: string | null;
  unrealizedPnlBps: number | null; // vs cost basis
}

const EMPTY: CostBasis = {
  avgCostPerUnitMinor: null,
  costBasisMinor: null,
  unrealizedPnlMinor: null,
  unrealizedPnlBps: null,
};

/**
 * @param heldQtyBase current holding in base units (from the ledger)
 * @param currentPriceMinor current per-base-unit price
 */
export async function getCostBasis(
  userId: string,
  assetId: string,
  heldQtyBase: bigint,
  currentPriceMinor: bigint | null
): Promise<CostBasis> {
  const db = getDb();

  const orderBuys = await db.query<{ qty_base: string | number; gross_minor: string | number }>(
    "SELECT qty_base, gross_minor FROM orders WHERE user_id = ? AND asset_id = ? AND side = 'buy' AND status = 'filled'",
    [userId, assetId]
  );
  const tradeBuys = await db.query<{ qty: string; price_minor: string }>(
    "SELECT qty, price_minor FROM trades WHERE buyer_user_id = ? AND asset_id = ?",
    [userId, assetId]
  );

  let qtyBought = 0n;
  let costTotal = 0n;
  for (const o of orderBuys) {
    qtyBought += BigInt(o.qty_base);
    costTotal += BigInt(o.gross_minor);
  }
  for (const t of tradeBuys) {
    const q = BigInt(t.qty);
    qtyBought += q;
    costTotal += q * BigInt(t.price_minor);
  }

  if (qtyBought <= 0n) return EMPTY;

  const avgCostPerUnit = costTotal / qtyBought;
  const basis = avgCostPerUnit * heldQtyBase;
  const result: CostBasis = {
    avgCostPerUnitMinor: avgCostPerUnit.toString(),
    costBasisMinor: basis.toString(),
    unrealizedPnlMinor: null,
    unrealizedPnlBps: null,
  };

  if (currentPriceMinor != null && heldQtyBase > 0n && basis > 0n) {
    const marketValue = currentPriceMinor * heldQtyBase;
    const pnl = marketValue - basis;
    result.unrealizedPnlMinor = pnl.toString();
    result.unrealizedPnlBps = Number((pnl * 10000n) / basis);
  }

  return result;
}
