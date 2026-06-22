/**
 * RWA issuer integration seam — Ondo, Securitize, RealT-style third-party listings (Module 05).
 */

import { AppError, ErrorCode } from "../errors";
import { config } from "../config";

export interface RwaListing {
  externalId: string;
  name: string;
  kind: "treasury" | "real_estate" | "private_credit" | "gold";
  issuer: string;
  minTier: number;
  priceMinor: bigint;
  currency: string;
  yieldBps?: number;
  lockupDays?: number;
}

export interface RwaIssuerProvider {
  name: string;
  fetchListings(): Promise<RwaListing[]>;
}

function simulatedListings(): RwaListing[] {
  return [
    { externalId: "ondo-ousg", name: "OUSG Short-Term Treasuries", kind: "treasury", issuer: "Ondo Finance", minTier: 2, priceMinor: 100_000_000n, currency: "USDC", yieldBps: 450 },
    { externalId: "realt-demo-1", name: "Detroit Single-Family Fraction", kind: "real_estate", issuer: "RealT (simulated)", minTier: 2, priceMinor: 5_000_000_000n, currency: "USDC", yieldBps: 900, lockupDays: 0 },
  ];
}

function simulatedProvider(): RwaIssuerProvider {
  return { name: "simulated", async fetchListings() { return simulatedListings(); } };
}

function notImplemented(name: string): RwaIssuerProvider {
  return {
    name,
    async fetchListings() {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `RWA_ISSUER_PROVIDER=${name} is not wired — integrate issuer API`);
    },
  };
}

let provider: RwaIssuerProvider | null = null;
export function setRwaIssuerProvider(p: RwaIssuerProvider | null): void {
  provider = p;
}

export function getRwaIssuerProvider(): RwaIssuerProvider {
  if (provider) return provider;
  switch (config.RWA_ISSUER_PROVIDER) {
    case "ondo":
      return notImplemented("ondo");
    case "securitize":
      return notImplemented("securitize");
    case "realt":
      return notImplemented("realt");
    default:
      return simulatedProvider();
  }
}

export async function fetchRwaCatalog(): Promise<RwaListing[]> {
  if (!config.RWA_ISSUER_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "RWA issuer integration is disabled");
  }
  return getRwaIssuerProvider().fetchListings();
}
