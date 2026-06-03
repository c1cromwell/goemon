/**
 * Money & quantity formatting — NON-NEGOTIABLE: amounts are integer minor units.
 *
 * Mirrors backend/src/db/money.ts. We NEVER parse floats or run amounts through
 * `Number()`; all math is on `bigint`, formatting is string surgery. The wire
 * carries minor units as decimal strings (e.g. "1000000"); we render them.
 */

/** Decimal places per currency / token symbol (mirror of the backend). */
export const KNOWN_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  NGN: 2,
  PHP: 2,
  BRL: 2,
  USDC: 6,
  USDT: 6,
  HBAR: 8,
};

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function decimalsFor(currency: string): number {
  return KNOWN_DECIMALS[currency] ?? 2;
}

/** Group the integer part with thousands separators (string in → string out). */
function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Split a non-negative minor-unit bigint into grouped int + fixed-width frac. */
function splitMinor(abs: bigint, decimals: number): { int: string; frac: string } {
  const s = abs.toString().padStart(decimals + 1, "0");
  const cut = s.length - decimals;
  const int = group(s.slice(0, cut));
  const frac = decimals > 0 ? s.slice(cut) : "";
  return { int, frac };
}

export interface FormatMoneyOpts {
  /** Show a leading "+" for positive values (e.g. credits). */
  signed?: boolean;
  /** Trim trailing zeros in the fraction down to `minFraction` (default 2). */
  trim?: boolean;
  minFraction?: number;
}

/**
 * Format an integer minor-unit amount for display.
 *   formatMoney("123456", "USD")  -> "$1,234.56"
 *   formatMoney("2500000", "USDC") -> "2.50 USDC"   (trimmed)
 */
export function formatMoney(
  minor: string | bigint | number,
  currency: string,
  opts: FormatMoneyOpts = {}
): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const decimals = decimalsFor(currency);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  let { int, frac } = splitMinor(abs, decimals);

  if (opts.trim && frac) {
    const min = opts.minFraction ?? 2;
    frac = frac.replace(/0+$/, "");
    while (frac.length < min) frac += "0";
  }

  const symbol = SYMBOLS[currency];
  const body = frac ? `${int}.${frac}` : int;
  const sign = negative ? "-" : opts.signed ? "+" : "";

  return symbol ? `${sign}${symbol}${body}` : `${sign}${body} ${currency}`;
}

/**
 * Format an asset quantity held in base units (decimals from the asset).
 * Whole-unit assets (decimals 0) render as plain grouped integers.
 *   formatUnits("5", 0)        -> "5"
 *   formatUnits("1500000", 6)  -> "1.5"
 */
export function formatUnits(base: string | bigint | number, decimals: number): string {
  const value = typeof base === "bigint" ? base : BigInt(base);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const { int, frac } = splitMinor(abs, decimals);
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed ? `${int}.${trimmed}` : int;
  return negative ? `-${body}` : body;
}

/**
 * Parse a human decimal amount ("12", "12.3", "12.34") into integer minor units
 * as a string — string surgery only, never `parseFloat`. Returns null if the
 * input isn't a valid amount with at most `decimals` fractional digits.
 */
export function decimalToMinor(input: string, decimals = 2): string | null {
  const m = input.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const whole = m[1]!;
  const frac = (m[2] ?? "").slice(0, decimals + 1);
  if (frac.length > decimals) return null; // more precision than the unit allows
  const padded = frac.padEnd(decimals, "0");
  const minor = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  return minor.toString();
}

/** Convenience: render a {amount,currency} money JSON object. */
export function formatMoneyJSON(
  m: { amount: string; currency: string } | null | undefined,
  opts?: FormatMoneyOpts
): string {
  if (!m) return "—";
  return formatMoney(m.amount, m.currency, opts);
}
