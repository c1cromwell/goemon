/**
 * FX quote seam — currency-conversion quotes (QUOTE-ONLY; off the money path).
 *
 * Mirrors marketDataService: a swappable provider with source / as-of / staleness,
 * append-only snapshots, a metric. It does NOT move money — cross-currency
 * settlement (a journal that debits one currency and credits another with an FX
 * spread) is a deliberately deferred later stage. This service only answers
 * "what would converting X cost?" so the multi-currency surface has rates to show.
 *
 * Rates are integer parts-per-million (ratePpm = rate × 1e6) — never floats — and
 * conversion is exact integer arithmetic that accounts for differing decimals
 * between the two currencies (USD 2dp ↔ USDC 6dp, etc.).
 *
 * Providers: simulated (default, offline) | circle | oanda (NOT_IMPLEMENTED stubs).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { fxQuoteTotal } from "../observability/metrics";
import { assertSupported } from "./currencyRegistry";

export type FxSource = "simulated" | "circle" | "oanda";

const PPM = 1_000_000n;

const STALENESS_MS: Record<FxSource, number> = {
  simulated: 60_000,
  circle: 60_000,
  oanda: 60_000,
};

export interface FxRate {
  ratePpm: bigint; // price of 1 unit of FROM expressed in TO, × 1e6
  source: FxSource;
  asOf: string;
}

export interface FxProvider {
  name: FxSource;
  getRate(from: string, to: string): Promise<FxRate>;
}

export interface FxQuote {
  from: string;
  to: string;
  fromAmountMinor: string;
  toAmountMinor: string;
  rate: string; // human-readable decimal, ratePpm / 1e6
  ratePpm: string;
  source: FxSource;
  asOf: string;
  stale: boolean;
}

function assertFxEnabled(): void {
  if (!config.FX_ENABLED) {
    throw new AppError(ErrorCode.FX_DISABLED, "FX quotes are not enabled on this server");
  }
}

// Simulated USD value (micro-USD) of one unit of each currency — the offline rate
// source. Cross rates derive from these, so every enabled pair has a quote.
const SIM_USD_MICRO: Record<string, bigint> = {
  USD: 1_000_000n,
  USDC: 1_000_000n,
  USDT: 1_000_000n,
  EUR: 1_080_000n,
  EURC: 1_080_000n,
};

function simulatedProvider(): FxProvider {
  return {
    name: "simulated",
    async getRate(from, to) {
      const f = SIM_USD_MICRO[from];
      const t = SIM_USD_MICRO[to];
      if (f === undefined || t === undefined) {
        throw new AppError(ErrorCode.NOT_IMPLEMENTED, `Simulated FX has no rate for ${from}/${to}`);
      }
      return { ratePpm: (f * PPM) / t, source: "simulated", asOf: new Date().toISOString() };
    },
  };
}

function notImplemented(name: FxSource): FxProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, `FX_RATE_PROVIDER=${name} is not wired — integrate a licensed FX rate feed`);
  };
  return { name, getRate: fail };
}

let provider: FxProvider | null = null;
export function setFxProvider(p: FxProvider | null): void {
  provider = p;
}

export function getFxProvider(): FxProvider {
  if (provider) return provider;
  switch (config.FX_RATE_PROVIDER) {
    case "circle":
      return notImplemented("circle");
    case "oanda":
      return notImplemented("oanda");
    default:
      return simulatedProvider();
  }
}

/** Exact integer conversion accounting for the two currencies' decimals (floor). */
export function convertAmountMinor(fromMinor: bigint, fromDec: number, toDec: number, ratePpm: bigint): bigint {
  let num = fromMinor * ratePpm; // scaled by 1e6 (ppm)
  let denom = PPM;
  const dd = toDec - fromDec;
  if (dd > 0) num *= 10n ** BigInt(dd);
  else if (dd < 0) denom *= 10n ** BigInt(-dd);
  return num / denom;
}

/** ratePpm → a 6dp decimal string for display (no float). */
export function ppmToDecimal(ppm: bigint): string {
  const whole = ppm / PPM;
  const frac = (ppm % PPM).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function staleness(source: FxSource, asOf: string): boolean {
  const ageMs = Date.now() - new Date(asOf).getTime();
  return ageMs > (STALENESS_MS[source] ?? STALENESS_MS.simulated);
}

/**
 * Quote a conversion. Both currencies must be enabled in the registry. Caches an
 * append-only snapshot and increments the metric. Throws on a disabled switch,
 * unknown currency, or non-positive amount — never returns a partial quote.
 */
export async function quote(input: { from: string; to: string; amountMinor: bigint }): Promise<FxQuote> {
  assertFxEnabled();
  const from = assertSupported(input.from);
  const to = assertSupported(input.to);
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");

  const rate = await getFxProvider().getRate(from.code, to.code);
  const toAmountMinor = convertAmountMinor(input.amountMinor, from.decimals, to.decimals, rate.ratePpm);
  const stale = staleness(rate.source, rate.asOf);

  await getDb().execute(
    `INSERT INTO fx_quotes (id, from_currency, to_currency, from_amount_minor, to_amount_minor, rate_ppm, source, as_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), from.code, to.code, input.amountMinor.toString(), toAmountMinor.toString(), rate.ratePpm.toString(), rate.source, rate.asOf, new Date().toISOString()]
  );
  fxQuoteTotal.inc({ pair: `${from.code}/${to.code}`, source: rate.source, stale: stale ? "true" : "false" });

  return {
    from: from.code,
    to: to.code,
    fromAmountMinor: input.amountMinor.toString(),
    toAmountMinor: toAmountMinor.toString(),
    rate: ppmToDecimal(rate.ratePpm),
    ratePpm: rate.ratePpm.toString(),
    source: rate.source,
    asOf: rate.asOf,
    stale,
  };
}
