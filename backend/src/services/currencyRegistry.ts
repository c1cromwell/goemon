/**
 * Currency / asset registry — the single source of truth for which currencies
 * the money surface admits.
 *
 * The ledger has always been multi-currency (ledgerService balances journals per
 * currency group; Money carries decimals). What was missing was a registry: every
 * route hardcoded `z.enum(["USD","USDC"])`, so the surface only admitted two
 * currencies even though the core could handle any. This centralizes that list so
 * adding a currency (EURC, USDT, …) is a one-line registry change, not a code sweep.
 *
 * `decimals` mirrors db/money.ts KNOWN_DECIMALS (Money stays the only money type).
 * `kind` distinguishes fiat from stablecoins (stablecoins ride the same on-chain
 * rail; fiat needs an on/off-ramp). `enabled` gates a currency on the surface
 * without removing its definition — flip it to turn a currency on.
 */

import { z } from "zod";
import { AppError, ErrorCode } from "../errors";

export type CurrencyKind = "fiat" | "stablecoin";

export interface CurrencyDef {
  code: string;
  decimals: number;
  kind: CurrencyKind;
  /** When false, the registry knows the currency but the money surface rejects it. */
  enabled: boolean;
  label: string;
}

/**
 * The registry. USD/USDC/USDT are the currently-live set (what the routes admit
 * today). EURC is defined but DISABLED — it exists to prove "multi-currency is a
 * config change": flip `enabled` and the routes accept it with no code change.
 */
const REGISTRY: Record<string, CurrencyDef> = {
  USD: { code: "USD", decimals: 2, kind: "fiat", enabled: true, label: "US Dollar" },
  USDC: { code: "USDC", decimals: 6, kind: "stablecoin", enabled: true, label: "USD Coin" },
  USDT: { code: "USDT", decimals: 6, kind: "stablecoin", enabled: true, label: "Tether USD" },
  EURC: { code: "EURC", decimals: 6, kind: "stablecoin", enabled: false, label: "Euro Coin" },
};

function norm(code: string): string {
  return code.trim().toUpperCase();
}

/** Look up a currency definition (enabled or not), or undefined. */
export function getCurrency(code: string): CurrencyDef | undefined {
  return REGISTRY[norm(code)];
}

/** True only if the currency is known AND enabled on the money surface. */
export function isSupportedCurrency(code: string): boolean {
  const c = REGISTRY[norm(code)];
  return !!c && c.enabled;
}

/** Throw VALIDATION unless the currency is known and enabled. */
export function assertSupported(code: string): CurrencyDef {
  const c = REGISTRY[norm(code)];
  if (!c || !c.enabled) {
    throw new AppError(ErrorCode.VALIDATION, `Unsupported currency "${code}"`);
  }
  return c;
}

/** All enabled currencies (for the /api/fx/currencies surface). */
export function listCurrencies(): CurrencyDef[] {
  return Object.values(REGISTRY).filter((c) => c.enabled);
}

/** Codes admitted on the money surface — the registry-driven replacement for the
 *  scattered `z.enum(["USD","USDC"])`. */
export function enabledCurrencyCodes(): string[] {
  return listCurrencies().map((c) => c.code);
}

/**
 * A Zod schema that accepts any enabled currency (case-insensitive), normalized to
 * upper-case. Drop-in for `z.enum(["USD","USDC"]).default("USD")` across the money
 * routes; the allowlist now comes from the registry, not a hardcoded literal.
 */
export function currencySchema(defaultCode = "USD") {
  return z
    .string()
    .default(defaultCode)
    .transform((s) => s.toUpperCase())
    .refine(isSupportedCurrency, { message: "Unsupported currency" });
}

/** Like currencySchema but optional (undefined stays undefined; no default). */
export function optionalCurrencySchema() {
  return z
    .string()
    .transform((s) => s.toUpperCase())
    .refine(isSupportedCurrency, { message: "Unsupported currency" })
    .optional();
}

/** Test-only: toggle a currency's enabled flag (e.g. prove EURC needs no code change). */
export function __setEnabledForTest(code: string, enabled: boolean): void {
  const c = REGISTRY[norm(code)];
  if (c) c.enabled = enabled;
}
