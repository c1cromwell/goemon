/**
 * Phase 24.3 — Neobank production readiness (partner-gated; code seam for Column webhooks).
 */

import { config } from "../config";

export interface NeobankReadinessItem {
  capability: string;
  enabled: boolean;
  provider: string;
  partnerRequired: boolean;
  prodFatal: boolean;
}

export interface NeobankProductionStatus {
  ready: boolean;
  items: NeobankReadinessItem[];
  blockers: string[];
  firstPartner: string;
}

export function getNeobankProductionStatus(): NeobankProductionStatus {
  const items: NeobankReadinessItem[] = [
    {
      capability: "ACH/wire deposit & withdraw",
      enabled: !!config.BANK_RAILS_ENABLED,
      provider: config.BANK_RAIL_PROVIDER,
      partnerRequired: true,
      prodFatal: true,
    },
    {
      capability: "Debit card",
      enabled: !!config.CARDS_ENABLED,
      provider: config.CARD_PROCESSOR ?? "simulated",
      partnerRequired: true,
      prodFatal: true,
    },
    {
      capability: "Bill pay",
      enabled: !!config.BILLPAY_ENABLED,
      provider: config.BANK_RAIL_PROVIDER,
      partnerRequired: true,
      prodFatal: true,
    },
    {
      capability: "KYC/IDV",
      enabled: true,
      provider: config.IDV_PROVIDER,
      partnerRequired: config.IDV_PROVIDER !== "simulated",
      prodFatal: config.isProd && config.IDV_PROVIDER === "simulated",
    },
  ];

  const blockers: string[] = [];
  if (!config.BANK_RAILS_ENABLED) blockers.push("BANK_RAILS_ENABLED=false");
  if (config.BANK_RAIL_PROVIDER === "simulated") blockers.push("BANK_RAIL_PROVIDER=simulated — wire Column/Treasury Prime/Unit");
  if (config.isProd && config.IDV_PROVIDER === "simulated") blockers.push("IDV_PROVIDER=simulated in production");

  return {
    ready: blockers.length === 0 && items.every((i) => !i.prodFatal || (i.enabled && i.provider !== "simulated")),
    items,
    blockers,
    firstPartner: "Column or Treasury Prime (BaaS + FBO)",
  };
}

export interface BankWebhookEvent {
  type: string;
  externalRef: string;
  amountMinor?: string;
  currency?: string;
  status?: string;
}

/** Parse Column-style webhook payload (stub — verify signature in prod). */
export function parseColumnWebhook(body: unknown): BankWebhookEvent {
  const b = body as Record<string, unknown>;
  return {
    type: String(b.type ?? "unknown"),
    externalRef: String(b.id ?? b.external_ref ?? uuidStub()),
    amountMinor: b.amount != null ? String(b.amount) : undefined,
    currency: b.currency != null ? String(b.currency) : "USD",
    status: b.status != null ? String(b.status) : undefined,
  };
}

function uuidStub(): string {
  return `col-${Date.now()}`;
}
