/**
 * Prometheus metrics for the fraud engine. Mounted at GET /metrics.
 */

import client from "prom-client";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const eventsTotal = new client.Counter({
  name: "fe_events_total",
  help: "Risk events ingested",
  labelNames: ["event_type", "mode"],
  registers: [registry],
});

export const decisionTotal = new client.Counter({
  name: "fe_decision_total",
  help: "Scored decisions by action and prod model",
  labelNames: ["action", "model"],
  registers: [registry],
});

export const shadowDivergenceTotal = new client.Counter({
  name: "fe_shadow_divergence_total",
  help: "Shadow/canary model decisions that diverged from prod",
  labelNames: ["model"],
  registers: [registry],
});

export const modelLatency = new client.Histogram({
  name: "fe_model_latency_seconds",
  help: "Model scoring latency",
  labelNames: ["model"],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
  registers: [registry],
});

export const casesTotal = new client.Counter({
  name: "fe_cases_total",
  help: "Fraud cases opened",
  labelNames: ["severity"],
  registers: [registry],
});

export const remediationTotal = new client.Counter({
  name: "fe_remediation_total",
  help: "Remediation callbacks to Goeman",
  labelNames: ["action", "result"],
  registers: [registry],
});

export const retrainTotal = new client.Counter({
  name: "fe_retrain_total",
  help: "Retrain runs registering a candidate model",
  labelNames: ["result"],
  registers: [registry],
});
