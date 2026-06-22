/**
 * Travel Rule seam — FATF $3K+ originator/beneficiary data (Module 06, Q-COMP-003).
 * Swappable provider: simulated default; notabene/sumsub/verifyvasp prod swaps.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export const TRAVEL_RULE_THRESHOLD_USD_MINOR = 300_000n; // $3,000.00 in cents

export interface TravelRulePayload {
  originatorName: string;
  originatorAccount: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  amountMinor: bigint;
  currency: string;
}

export interface TravelRuleProvider {
  name: string;
  transmit(payload: TravelRulePayload): Promise<{ transmissionId: string }>;
}

function simulatedProvider(): TravelRuleProvider {
  return {
    name: "simulated",
    async transmit() {
      return { transmissionId: `sim-tr-${uuidv4().slice(0, 8)}` };
    },
  };
}

function notImplemented(name: string): TravelRuleProvider {
  return {
    name,
    async transmit() {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `TRAVEL_RULE_PROVIDER=${name} is not wired`);
    },
  };
}

let provider: TravelRuleProvider | null = null;
export function setTravelRuleProvider(p: TravelRuleProvider | null): void {
  provider = p;
}

export function getTravelRuleProvider(): TravelRuleProvider {
  if (provider) return provider;
  switch (config.TRAVEL_RULE_PROVIDER) {
    case "notabene":
      return notImplemented("notabene");
    case "sumsub":
      return notImplemented("sumsub");
    case "verifyvasp":
      return notImplemented("verifyvasp");
    default:
      return simulatedProvider();
  }
}

export function requiresTravelRule(amountUsdMinor: bigint): boolean {
  return amountUsdMinor >= TRAVEL_RULE_THRESHOLD_USD_MINOR;
}

export async function transmitTravelRule(payload: TravelRulePayload): Promise<{ transmissionId: string; provider: string }> {
  if (!config.TRAVEL_RULE_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Travel Rule transmission is disabled");
  }
  const p = getTravelRuleProvider();
  const result = await p.transmit(payload);
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO travel_rule_transmissions (id, provider, transmission_id, amount_minor, currency, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, p.name, result.transmissionId, payload.amountMinor.toString(), payload.currency]
  );
  return { transmissionId: result.transmissionId, provider: p.name };
}
