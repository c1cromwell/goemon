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
