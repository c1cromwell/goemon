/**
 * Phase 18.6 — EquityIssuer seam (the swappable backing/redemption provider).
 *
 * A 1:1-backed tokenized equity token represents a REAL share held 1:1 by an issuer —
 * explicitly not a derivative or IOU. Argus is the on-chain wallet + compliance +
 * distribution layer; the issuer custodies the shares, pays dividends, and settles
 * redemptions. EQUITY_ISSUER selects the provider (same provider-seam pattern as
 * keyVaultService / signerService):
 *
 *   - "simulated" (default) — an in-process stand-in for dev/tests: returns a 1:1
 *     backing attestation and settles redemptions instantly (issuer cash account).
 *   - "dinari" / "firstparty" — production swaps (NOT_IMPLEMENTED stubs). v1 distributes a
 *     regulated 1:1 issuer (Dinari dShares: SEC-registered transfer agent, on-chain
 *     redemption, dividend pass-through); v2 is first-party issuance (Argus custodies via a
 *     partner + transfer agent + ATS). See docs/PHASE-18.6-TOKENIZED-EQUITIES.md.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export interface BackingAttestation {
  /** Underlying ticker the token is 1:1 backed by (e.g. AAPL). */
  symbol: string;
  /** Shares held in custody, in base units (matches on-chain supply when 1:1). */
  sharesCustodied: bigint;
  /** On-chain token supply, base units. Drift between this and sharesCustodied breaks 1:1. */
  tokenSupply: bigint;
  backedOneToOne: boolean;
  custodian: string;
  asOf: string;
}

export interface RedemptionResult {
  /** Cash proceeds delivered for the redeemed shares, in minor units. */
  proceedsMinor: bigint;
  /** Issuer / on-chain settlement reference. */
  externalRef: string;
}

export interface EquityIssuer {
  name: string;
  /** Prove the token is 1:1 backed by real custodied shares. */
  backingAttestation(symbol: string, tokenSupply: bigint): Promise<BackingAttestation>;
  /** Settle a redemption: the issuer delivers proceeds for `qtyBase` burned shares. */
  submitRedemption(input: {
    userId: string;
    symbol: string;
    qtyBase: bigint;
    pricePerUnitMinor: bigint;
  }): Promise<RedemptionResult>;
}

/**
 * Proceeds for redeeming qtyBase units at pricePerUnitMinor. Per-base-unit, matching the
 * marketplace's `gross = qtyBase * priceMinor` (equity tokens are whole-share, decimals 0).
 */
export function proceedsFor(qtyBase: bigint, pricePerUnitMinor: bigint): bigint {
  return qtyBase * pricePerUnitMinor;
}

function simulatedIssuer(): EquityIssuer {
  return {
    name: "simulated",
    async backingAttestation(symbol, tokenSupply) {
      // The stand-in always reports a clean 1:1 backing (a real issuer/custodian feed
      // would report the true custodied share count; drift is a reconciliation incident).
      return {
        symbol,
        sharesCustodied: tokenSupply,
        tokenSupply,
        backedOneToOne: true,
        custodian: "Simulated Custodian (dev)",
        asOf: new Date().toISOString(),
      };
    },
    async submitRedemption({ qtyBase, pricePerUnitMinor }) {
      return {
        proceedsMinor: proceedsFor(qtyBase, pricePerUnitMinor),
        externalRef: `sim-redeem-${Date.now()}`,
      };
    },
  };
}

function notImplemented(name: string): EquityIssuer {
  const fail = async (): Promise<never> => {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `EQUITY_ISSUER=${name} is not wired in this prototype — integrate the regulated issuer (backing feed + redemption settlement)`
    );
  };
  return { name, backingAttestation: fail, submitRedemption: fail };
}

/** Kill-switch guard for the Phase-18.6 prototype endpoints. */
export function assertEquitiesEnabled(): void {
  if (!config.EQUITIES_ENABLED) {
    throw new AppError(ErrorCode.EQUITIES_DISABLED, "Tokenized equities are currently unavailable");
  }
}

/**
 * Corporate actions (dividends/distributions) are available when EITHER tokenized
 * equities OR the tokenized treasury is enabled — both ride the same pro-rata
 * distribution engine. Treasury yield is a recurring dividend distribution.
 */
export function assertCorporateActionsEnabled(): void {
  if (!config.EQUITIES_ENABLED && !config.TREASURY_ENABLED) {
    throw new AppError(ErrorCode.EQUITIES_DISABLED, "Corporate actions are currently unavailable");
  }
}

let provider: EquityIssuer | null = null;

/** Inject a provider (tests) or clear it (null → re-derive from config). */
export function setEquityIssuer(p: EquityIssuer | null): void {
  provider = p;
}

export function getEquityIssuer(): EquityIssuer {
  if (provider) return provider;
  switch (config.EQUITY_ISSUER) {
    case "dinari":
      return notImplemented("dinari");
    case "firstparty":
      return notImplemented("firstparty");
    default:
      return simulatedIssuer();
  }
}
