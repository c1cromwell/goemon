/**
 * Phase 24.4 — Stablecoin production readiness (standalone Hedera path; Circle optional).
 */

import { config } from "../config";
import { getDb } from "../db";
import { getLatestRun } from "./reconciliationService";

export interface StablecoinProductionStatus {
  ready: boolean;
  network: string;
  hederaEnabled: boolean;
  usdcTokenConfigured: boolean;
  reconciliation: "ok" | "drift" | "skipped" | "error" | "unknown";
  signerMode: string;
  blockers: string[];
  optionalPartners: string[];
}

export async function getStablecoinProductionStatus(): Promise<StablecoinProductionStatus> {
  const blockers: string[] = [];
  if (!config.HEDERA_ENABLED) blockers.push("HEDERA_ENABLED=false");
  if (!config.HEDERA_USDC_TOKEN_ID) blockers.push("HEDERA_USDC_TOKEN_ID unset");
  if (!config.HEDERA_OPERATOR_ID || !config.HEDERA_OPERATOR_KEY) blockers.push("HEDERA operator credentials unset");

  let reconciliation: StablecoinProductionStatus["reconciliation"] = "unknown";
  try {
    const latest = await getLatestRun();
    reconciliation = latest?.result ?? "unknown";
    if (reconciliation === "drift") blockers.push("ledger⇄chain reconciliation drift");
  } catch {
    reconciliation = config.HEDERA_ENABLED ? "skipped" : "unknown";
  }

  if (config.isProd && config.HEDERA_NETWORK !== "mainnet") {
    blockers.push("production requires HEDERA_NETWORK=mainnet");
  }
  if (config.isProd && config.KMS_PROVIDER === "local") {
    blockers.push("production requires KMS_PROVIDER aws|gcp");
  }

  const optionalPartners: string[] = [];
  if (config.CCTP_PROVIDER === "simulated") optionalPartners.push("Circle CCTP for cross-chain USDC");
  if (config.ONRAMP_PROVIDER === "simulated") optionalPartners.push("Licensed on-ramp for fiat→USDC");

  return {
    ready: blockers.length === 0,
    network: config.HEDERA_NETWORK,
    hederaEnabled: !!config.HEDERA_ENABLED,
    usdcTokenConfigured: !!config.HEDERA_USDC_TOKEN_ID,
    reconciliation,
    signerMode: config.HEDERA_SIGNER ?? "keyvault",
    blockers,
    optionalPartners,
  };
}

export async function recordStablecoinReadinessSnapshot(): Promise<void> {
  const status = await getStablecoinProductionStatus();
  const { v4: uuidv4 } = await import("uuid");
  await getDb().execute(
    `INSERT INTO production_readiness_snapshots (id, workstream, status, details_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), "24.4_stablecoin", status.ready ? "ready" : "blocked", JSON.stringify(status), new Date().toISOString()]
  );
}
