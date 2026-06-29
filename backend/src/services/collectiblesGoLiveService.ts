/**
 * Phase 24.7 — Collectibles standalone go-live readiness (Courtyard optional).
 */

import { config } from "../config";
import { getDb } from "../db";

export interface CollectiblesGoLiveStatus {
  ready: boolean;
  standaloneReady: boolean;
  escrowEnabled: boolean;
  provider: string;
  pendingSellerReviews: number;
  blockers: string[];
  counselGates: string[];
}

export async function getCollectiblesGoLiveStatus(): Promise<CollectiblesGoLiveStatus> {
  const blockers: string[] = [];
  const counselGates: string[] = [];

  if (config.isProd && config.COLLECTIBLES_ESCROW_ENABLED) {
    counselGates.push("MSB/marketplace-intermediary counsel sign-off required for in-app escrow");
  }
  if (config.isProd && config.COLLECTIBLES_ESCROW_ENABLED === false) {
    blockers.push("Real-money escrow disabled — enable COLLECTIBLES_ESCROW_ENABLED after counsel");
  }

  const pending = await getDb().queryOne<{ n: number }>(
    "SELECT COUNT(*) as n FROM seller_collectible_submissions WHERE status = 'pending_human'"
  );

  const provider = config.COLLECTIBLES_PROVIDER ?? "simulated";
  if (provider === "simulated") {
    counselGates.push("Courtyard optional — seller P2P + demo inventory works standalone");
  }

  const standaloneReady = true;
  const escrowEnabled = !!config.COLLECTIBLES_ESCROW_ENABLED;

  return {
    ready: blockers.length === 0 && (standaloneReady || escrowEnabled),
    standaloneReady,
    escrowEnabled,
    provider,
    pendingSellerReviews: pending?.n ?? 0,
    blockers,
    counselGates,
  };
}
