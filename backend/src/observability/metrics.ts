/**
 * Phase 1 — Metrics (prom-client).
 *
 * Exposes counters/histograms used across the system. Mount the registry at
 * GET /metrics (see index.ts). Later phases increment ledgerPostTotal,
 * vpVerifyTotal, mcpCallTotal, hederaTxTotal.
 */

import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const ledgerPostTotal = new client.Counter({
  name: "ledger_post_total",
  help: "Number of ledger journals posted",
  labelNames: ["result"],
  registers: [registry],
});

export const vpVerifyTotal = new client.Counter({
  name: "vp_verify_total",
  help: "Verifiable Presentation verification attempts",
  labelNames: ["result"],
  registers: [registry],
});

export const mcpCallTotal = new client.Counter({
  name: "mcp_call_total",
  help: "MCP tool calls",
  labelNames: ["tool", "result"],
  registers: [registry],
});

export const hederaTxTotal = new client.Counter({
  name: "hedera_tx_total",
  help: "Hedera transactions submitted",
  labelNames: ["result"],
  registers: [registry],
});

export const fraudDecisionTotal = new client.Counter({
  name: "fraud_decision_total",
  help: "Fraud-engine decisions on money-path events (Stage 1 seam)",
  labelNames: ["event_type", "action"],
  registers: [registry],
});

// Phase 20 fraud add-on — call-outs to the standalone fraud engine + freeze callbacks.
export const fraudRemoteCallTotal = new client.Counter({
  name: "fraud_remote_call_total",
  help: "Calls to the standalone fraud engine",
  labelNames: ["mode", "result"], // mode: sync|async ; result: ok|degraded|error
  registers: [registry],
});

export const accountHoldTotal = new client.Counter({
  name: "account_hold_total",
  help: "Account holds placed/released via fraud remediation",
  labelNames: ["action", "source"], // action: place|release|flag ; source: fraud_engine|admin
  registers: [registry],
});

// Phase 17 — trading (Class-B SLO surface; kept distinct from Class-A money metrics).
export const tradingOrderTotal = new client.Counter({
  name: "trading_order_total",
  help: "Trading orders accepted on the hot path",
  labelNames: ["side", "result"],
  registers: [registry],
});

export const tradingSettlementTotal = new client.Counter({
  name: "trading_settlement_total",
  help: "Trading settlement outcomes (async worker)",
  labelNames: ["result"],
  registers: [registry],
});

// Phase 21 — Argus Pay (native stablecoin rail; escrow-protected merchant payments).
export const payEventTotal = new client.Counter({
  name: "pay_event_total",
  help: "Argus Pay payment-intent lifecycle events",
  labelNames: ["event"],
  registers: [registry],
});

// Phase 20 — ledger⇄chain reconciliation (invariant n).
export const reconciliationRunTotal = new client.Counter({
  name: "reconciliation_run_total",
  help: "Ledger vs on-chain reconciliation runs",
  labelNames: ["result"],
  registers: [registry],
});

export const reconciliationDriftAccounts = new client.Gauge({
  name: "reconciliation_drift_accounts",
  help: "Accounts with ledger vs on-chain drift in the latest reconciliation run",
  registers: [registry],
});

// Phase 15 — internal agent operations (back office; read/recommend/draft only).
export const agentRunTotal = new client.Counter({
  name: "agent_run_total",
  help: "Internal agent operations workflow runs",
  labelNames: ["skill", "outcome"], // outcome: executed|queued|rejected|error
  registers: [registry],
});

export const agentEscalationTotal = new client.Counter({
  name: "agent_escalation_total",
  help: "Internal agent operations runs escalated to a human gate",
  labelNames: ["skill", "reason"],
  registers: [registry],
});

// Phase 18.6 — tokenized equities (dividends + on-chain redemption).
export const equityDividendTotal = new client.Counter({
  name: "equity_dividend_total",
  help: "Per-holder dividend payouts posted for tokenized equities",
  labelNames: ["asset"],
  registers: [registry],
});

export const equityRedemptionTotal = new client.Counter({
  name: "equity_redemption_total",
  help: "Tokenized-equity redemptions",
  labelNames: ["result"], // settled | failed
  registers: [registry],
});

// Phase 19 — full-bank rails (fiat on/off-ramp + ACH/wire payouts).
export const bankTransferTotal = new client.Counter({
  name: "bank_transfer_total",
  help: "Bank-rail transfers (deposits/withdrawals)",
  labelNames: ["direction", "result"], // direction: in|out ; result: settled|failed|returned
  registers: [registry],
});

export const cardAuthTotal = new client.Counter({
  name: "card_auth_total",
  help: "Card authorization lifecycle events",
  labelNames: ["result"], // authorized | captured | voided | refunded
  registers: [registry],
});
