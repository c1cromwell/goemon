/**
 * Phase 30 — Market valuation seam (the "reference value vs price" signal).
 *
 * Swappable provider produces a per-unit REFERENCE value for an asset; the caller
 * compares it to the live listing price to surface a premium/discount. This is a
 * REFERENCE signal, never investment advice — treasury uses a real intrinsic (par);
 * other kinds use a deterministic simulated reference until a real market-data
 * provider (polygon/iex) is wired.
 *
 * Providers: simulated (default, offline) | polygon | iex (NOT_IMPLEMENTED stubs).
 */
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";

export type ValuationSource = "simulated" | "polygon" | "iex";

export interface ValuationInput {
  assetId: string;
  kind: string;
  metadata: Record<string, unknown>;
  priceMinor: bigint;
  currency: string;
}

export interface Valuation {
  referenceValueMinor: bigint;
  premiumDiscountBps: number; // (price - reference) / reference; >0 = trades above reference
  label: "premium" | "discount" | "near_reference";
  source: ValuationSource;
  asOf: string;
  simulated: boolean;
}

export interface ValuationProvider {
  name: ValuationSource;
  reference(input: ValuationInput): Promise<bigint>;
}

/** Stable [-1,1) pseudo-random from a string — keeps the reference value from jittering per request. */
function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // map to [-1, 1)
  return ((h >>> 0) % 20000) / 10000 - 1;
}

const simulatedProvider: ValuationProvider = {
  name: "simulated",
  async reference(input) {
    // Treasury has a true per-unit intrinsic: par.
    if (input.kind === "treasury") {
      const par = BigInt((input.metadata.parMinor as string) ?? input.priceMinor.toString());
      return par;
    }
    // Collectibles: use the seller comp if we have one (a real market comp).
    if (input.kind === "collectible") {
      const comp = await getDb().queryOne<{ comp_price_minor: string | null }>(
        "SELECT comp_price_minor FROM seller_collectible_submissions WHERE asset_id = ? AND comp_price_minor IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [input.assetId]
      );
      if (comp?.comp_price_minor) return BigInt(comp.comp_price_minor);
    }
    // Everything else: a deterministic simulated reference within ±9% of price.
    const drift = seededUnit(input.assetId) * 0.09;
    const ref = (input.priceMinor * BigInt(Math.round((1 + drift) * 10000))) / 10000n;
    return ref > 0n ? ref : input.priceMinor;
  },
};

const stub = (name: ValuationSource): ValuationProvider => ({
  name,
  async reference() {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `Market valuation provider '${name}' is not implemented — wire the real market-data API.`
    );
  },
});

function provider(): ValuationProvider {
  switch (config.MARKET_VALUATION_PROVIDER) {
    case "polygon":
      return stub("polygon");
    case "iex":
      return stub("iex");
    default:
      return simulatedProvider;
  }
}

export async function valuate(input: ValuationInput): Promise<Valuation> {
  const p = provider();
  const reference = await p.reference(input);
  const ref = reference > 0n ? reference : input.priceMinor;
  const premiumDiscountBps = ref > 0n ? Number(((input.priceMinor - ref) * 10000n) / ref) : 0;
  const label: Valuation["label"] =
    premiumDiscountBps > 200 ? "premium" : premiumDiscountBps < -200 ? "discount" : "near_reference";
  return {
    referenceValueMinor: ref,
    premiumDiscountBps,
    label,
    source: p.name,
    asOf: new Date().toISOString(),
    simulated: p.name === "simulated",
  };
}
