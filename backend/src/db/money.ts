/**
 * Phase 0 — Money handling (NON-NEGOTIABLE rules).
 *
 * All monetary amounts are integer minor units represented as `bigint`.
 *   - USD is stored/computed as integer cents.        $10,000.00  -> 1_000_000n
 *   - Tokens are stored in their smallest unit.        USDC (6dp)  -> micro-USDC
 *
 * We NEVER use number/float/double for money. Floats cannot represent decimal
 * money exactly (0.1 + 0.2 !== 0.3), which produces silent rounding errors that
 * are unacceptable in financial software.
 *
 * Database storage: money is stored in INTEGER (SQLite) / BIGINT (Postgres)
 * columns named `*_minor`, always paired with a `currency` column. When reading
 * from the DB, coerce the raw value (string from pg, number from sqlite) through
 * `Money.fromDb()` which routes via BigInt() — exact for both drivers.
 *
 * JSON serialization: a Money is serialized as { amount: string, currency, decimals }
 * (amount as a decimal string, NEVER a JS number) so precision survives the wire.
 */

export interface MoneyJSON {
  amount: string; // minor units as a base-10 string, e.g. "1000000"
  currency: string; // ISO 4217 for fiat ("USD") or token symbol ("USDC")
  decimals: number; // number of decimal places, e.g. 2 for USD, 6 for USDC
}

const KNOWN_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  NGN: 2,
  PHP: 2,
  BRL: 2,
  USDC: 6,
  USDT: 6,
  HBAR: 8,
};

export class Money {
  readonly amount: bigint; // minor units
  readonly currency: string;
  readonly decimals: number;

  private constructor(amount: bigint, currency: string, decimals: number) {
    this.amount = amount;
    this.currency = currency;
    this.decimals = decimals;
  }

  /** Construct from minor units. */
  static of(amountMinor: bigint, currency: string, decimals?: number): Money {
    const d = decimals ?? KNOWN_DECIMALS[currency.toUpperCase()];
    if (d === undefined) {
      throw new Error(`Unknown currency "${currency}"; pass decimals explicitly`);
    }
    return new Money(amountMinor, currency.toUpperCase(), d);
  }

  /** Convenience for USD cents. */
  static usd(cents: bigint): Money {
    return Money.of(cents, "USD", 2);
  }

  /** Convenience for USDC micro-units (6 dp). */
  static usdc(micro: bigint): Money {
    return Money.of(micro, "USDC", 6);
  }

  /**
   * Read a money value coming out of the database.
   * pg returns BIGINT as a string; better-sqlite3 returns INTEGER as a number.
   * BigInt() handles both exactly (numbers must be safe integers, which monetary
   * cents are well within for any realistic balance).
   */
  static fromDb(raw: string | number | bigint | null | undefined, currency: string, decimals?: number): Money {
    if (raw === null || raw === undefined) return Money.of(0n, currency, decimals);
    return Money.of(BigInt(raw), currency, decimals);
  }

  static fromJSON(j: MoneyJSON): Money {
    return new Money(BigInt(j.amount), j.currency.toUpperCase(), j.decimals);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency, this.decimals);
  }

  sub(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency, this.decimals);
  }

  /** Multiply by an integer scalar (e.g. quantity). Keeps money integer-exact. */
  mulInt(scalar: bigint): Money {
    return new Money(this.amount * scalar, this.currency, this.decimals);
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  gte(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount >= other.amount;
  }

  gt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  /** The raw minor-unit value, for writing to a DB column. */
  toMinor(): bigint {
    return this.amount;
  }

  /** For DB drivers that prefer a string for BIGINT params. */
  toMinorString(): string {
    return this.amount.toString();
  }

  /** Human-readable display only — never use the result for further math. */
  format(opts?: { withSymbol?: boolean }): string {
    const negative = this.amount < 0n;
    const abs = negative ? -this.amount : this.amount;
    const s = abs.toString().padStart(this.decimals + 1, "0");
    const whole = s.slice(0, s.length - this.decimals) || "0";
    const frac = this.decimals > 0 ? "." + s.slice(s.length - this.decimals) : "";
    // group thousands in the whole part
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = negative ? "-" : "";
    const symbol = opts?.withSymbol && this.currency === "USD" ? "$" : "";
    const suffix = symbol ? "" : ` ${this.currency}`;
    return `${sign}${symbol}${grouped}${frac}${suffix}`;
  }

  toJSON(): MoneyJSON {
    return { amount: this.amount.toString(), currency: this.currency, decimals: this.decimals };
  }
}

/**
 * Express/JSON cannot serialize BigInt by default. Call this once at boot to make
 * any stray BigInt serialize as a string rather than throwing. (Money itself uses
 * toJSON, but this is a safety net for raw bigint fields.)
 */
export function installBigIntJSONSerializer(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}
