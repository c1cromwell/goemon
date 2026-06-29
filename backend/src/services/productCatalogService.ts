/**
 * Phase 24.8 — Supported product catalog (honest availability per SKU).
 *
 * Drives UX, agent tools, and marketing: only products Argus actually supports
 * appear as available; 24/7 badge applies only where `availability === "24_7"`.
 */

import { config } from "../config";

export type ProductAvailability = "24_7" | "exchange_hours" | "corridor_limited" | "disabled";

export interface SupportedProduct {
  sku: string;
  name: string;
  category: string;
  availability: ProductAvailability;
  regions: string[];
  minTier: number;
  enabled: boolean;
  /** True when a third-party contract is required for real money (not standalone). */
  requiresPartner: boolean;
  /** True when the prototype seam can go live without external partners. */
  standaloneReady: boolean;
  configFlag?: string;
}

function product(p: SupportedProduct): SupportedProduct {
  return p;
}

/** Static SKU registry — `enabled` derived from config at read time. */
const CATALOG: SupportedProduct[] = [
  product({
    sku: "wallet.usdc.p2p",
    name: "USDC send & receive (Hedera)",
    category: "stablecoin",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 0,
    enabled: true,
    requiresPartner: false,
    standaloneReady: true,
  }),
  product({
    sku: "pay.native.p2p",
    name: "P2P ledger transfer",
    category: "instant_payments",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 0,
    enabled: true,
    requiresPartner: false,
    standaloneReady: true,
  }),
  product({
    sku: "pay.merchant.argus",
    name: "Argus Pay merchant checkout",
    category: "instant_payments",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 1,
    enabled: !!config.ARGUS_PAY_ENABLED,
    requiresPartner: false,
    standaloneReady: true,
    configFlag: "ARGUS_PAY_ENABLED",
  }),
  product({
    sku: "agent.x401.identity",
    name: "x401 identity proof (Argus VC)",
    category: "identity",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 0,
    enabled: !!config.X401_ENABLED,
    requiresPartner: false,
    standaloneReady: true,
    configFlag: "X401_ENABLED",
  }),
  product({
    sku: "agent.x402.commerce",
    name: "x402 agent commerce (HTTP pay gate)",
    category: "instant_payments",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 1,
    enabled: !!config.X402_ENABLED && !!config.ARGUS_PAY_ENABLED,
    requiresPartner: false,
    standaloneReady: true,
    configFlag: "X402_ENABLED",
  }),
  product({
    sku: "savings.borderless.usdc",
    name: "Borderless USDC savings (self-accrual)",
    category: "savings",
    availability: "24_7",
    regions: ["GLOBAL"],
    minTier: 1,
    enabled: !!config.BORDERLESS_SAVINGS_ENABLED,
    requiresPartner: false,
    standaloneReady: true,
    configFlag: "BORDERLESS_SAVINGS_ENABLED",
  }),
  product({
    sku: "marketplace.collectibles",
    name: "Tokenized collectibles (Collect)",
    category: "tokenized_collectibles",
    availability: "24_7",
    regions: ["US"],
    minTier: 0,
    enabled: true,
    requiresPartner: false,
    standaloneReady: true,
  }),
  product({
    sku: "marketplace.collectibles.escrow",
    name: "In-app collectible escrow checkout",
    category: "tokenized_collectibles",
    availability: "24_7",
    regions: ["US"],
    minTier: 1,
    enabled: !!config.COLLECTIBLES_ESCROW_ENABLED,
    requiresPartner: true,
    standaloneReady: true,
    configFlag: "COLLECTIBLES_ESCROW_ENABLED",
  }),
  product({
    sku: "marketplace.equity.tokenized",
    name: "Tokenized 1:1 public equities",
    category: "tokenized_stocks",
    availability: "exchange_hours",
    regions: ["US"],
    minTier: 2,
    enabled: !!config.EQUITIES_ENABLED,
    requiresPartner: true,
    standaloneReady: false,
    configFlag: "EQUITIES_ENABLED",
  }),
  product({
    sku: "bank.us.ach",
    name: "US ACH deposit & withdraw",
    category: "neobank",
    availability: "exchange_hours",
    regions: ["US"],
    minTier: 2,
    enabled: !!config.BANK_RAILS_ENABLED,
    requiresPartner: true,
    standaloneReady: false,
    configFlag: "BANK_RAILS_ENABLED",
  }),
  product({
    sku: "bank.us.card",
    name: "US debit card",
    category: "neobank",
    availability: "24_7",
    regions: ["US"],
    minTier: 2,
    enabled: !!config.CARDS_ENABLED,
    requiresPartner: true,
    standaloneReady: false,
    configFlag: "CARDS_ENABLED",
  }),
  product({
    sku: "fx.cross_border",
    name: "Cross-border FX send",
    category: "instant_payments",
    availability: "corridor_limited",
    regions: ["NG", "PH", "BR", "GLOBAL"],
    minTier: 1,
    enabled: !!config.FX_SETTLEMENT_ENABLED,
    requiresPartner: true,
    standaloneReady: false,
    configFlag: "FX_SETTLEMENT_ENABLED",
  }),
  product({
    sku: "trading.spot.equity",
    name: "US equities spot (off-chain brokerage)",
    category: "markets",
    availability: "exchange_hours",
    regions: ["US"],
    minTier: 2,
    enabled: !!config.TRADING_ENABLED,
    requiresPartner: true,
    standaloneReady: false,
    configFlag: "TRADING_ENABLED",
  }),
];

export function listSupportedProducts(opts?: { enabledOnly?: boolean; category?: string }): SupportedProduct[] {
  let rows = CATALOG.map((p) => ({ ...p, enabled: resolveEnabled(p) }));
  if (opts?.enabledOnly) rows = rows.filter((p) => p.enabled);
  if (opts?.category) rows = rows.filter((p) => p.category === opts.category);
  return rows;
}

export function getProduct(sku: string): SupportedProduct | undefined {
  const base = CATALOG.find((p) => p.sku === sku);
  if (!base) return undefined;
  return { ...base, enabled: resolveEnabled(base) };
}

export function isProductAvailable(sku: string): boolean {
  const p = getProduct(sku);
  return !!p?.enabled;
}

function resolveEnabled(p: SupportedProduct): boolean {
  if (p.sku === "wallet.usdc.p2p" || p.sku === "pay.native.p2p" || p.sku === "marketplace.collectibles") {
    return true;
  }
  if (p.configFlag) {
    const key = p.configFlag as keyof typeof config;
    return !!(config as Record<string, unknown>)[key];
  }
  return p.enabled;
}

export function catalogSummary(): {
  total: number;
  enabled: number;
  standaloneReady: number;
  requiresPartner: number;
  available24_7: number;
} {
  const rows = listSupportedProducts();
  const enabled = rows.filter((p) => p.enabled);
  return {
    total: rows.length,
    enabled: enabled.length,
    standaloneReady: enabled.filter((p) => p.standaloneReady).length,
    requiresPartner: enabled.filter((p) => p.requiresPartner).length,
    available24_7: enabled.filter((p) => p.availability === "24_7").length,
  };
}
