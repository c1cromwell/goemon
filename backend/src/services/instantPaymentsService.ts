/**
 * Phase 24.5 — Instant payment SLAs (native rail; partner FedNow optional).
 */

import { config } from "../config";
import { registry } from "../observability/metrics";

export interface InstantPaymentSla {
  rail: string;
  targetP99Ms: number;
  availability: string;
  partnerRequired: boolean;
  enabled: boolean;
}

export interface InstantPaymentsStatus {
  slas: InstantPaymentSla[];
  nativeRailEnabled: boolean;
  fedNowReady: boolean;
  blockers: string[];
}

const NATIVE_SLAS: InstantPaymentSla[] = [
  { rail: "ledger.p2p_transfer", targetP99Ms: 2000, availability: "24_7", partnerRequired: false, enabled: true },
  { rail: "pay.argus_intent", targetP99Ms: 10000, availability: "24_7", partnerRequired: false, enabled: !!config.ARGUS_PAY_ENABLED },
  { rail: "pay.payment_request", targetP99Ms: 2000, availability: "24_7", partnerRequired: false, enabled: true },
  { rail: "hedera.usdc_settlement", targetP99Ms: 15000, availability: "24_7", partnerRequired: false, enabled: !!config.HEDERA_ENABLED },
  { rail: "bank.fednow", targetP99Ms: 60000, availability: "US_banking_hours", partnerRequired: true, enabled: false },
  { rail: "bank.rtp", targetP99Ms: 60000, availability: "US_banking_hours", partnerRequired: true, enabled: false },
];

export function getInstantPaymentsStatus(): InstantPaymentsStatus {
  const blockers: string[] = [];
  const fedNowReady = config.BANK_RAILS_ENABLED && config.BANK_RAIL_PROVIDER !== "simulated";
  if (!fedNowReady) blockers.push("FedNow/RTP requires live BANK_RAIL_PROVIDER (Column/TP/Unit)");

  const slas = NATIVE_SLAS.map((s) =>
    s.rail.startsWith("bank.") ? { ...s, enabled: fedNowReady } : s
  );

  return {
    slas,
    nativeRailEnabled: true,
    fedNowReady,
    blockers: fedNowReady ? [] : blockers,
  };
}

/** Best-effort p99 from Prometheus histogram (returns null if metric absent). */
export function getObservedTransferP99Ms(): number | null {
  try {
    const metric = registry.getSingleMetric("http_request_duration_seconds");
    if (!metric) return null;
    const json = metric.get();
    const rows = (json as { values?: Array<{ labels: Record<string, string>; value: number }> }).values ?? [];
    const transferRows = rows.filter((r) => r.labels.route?.includes("transfer") || r.labels.route?.includes("pay"));
    if (!transferRows.length) return null;
    const max = Math.max(...transferRows.map((r) => r.value));
    return Math.round(max * 1000);
  } catch {
    return null;
  }
}
