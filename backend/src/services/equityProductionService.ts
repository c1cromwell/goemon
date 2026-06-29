/**
 * Phase 24.6 — Tokenized equities production readiness (Dinari/Backed optional).
 */

import { config } from "../config";

export interface EquityProductionStatus {
  ready: boolean;
  enabled: boolean;
  issuer: string;
  standaloneDemo: boolean;
  blockers: string[];
  partnerOptions: string[];
}

export function getEquityProductionStatus(): EquityProductionStatus {
  const issuer = config.EQUITY_ISSUER;
  const blockers: string[] = [];
  if (!config.EQUITIES_ENABLED) blockers.push("EQUITIES_ENABLED=false");
  if (issuer === "simulated") blockers.push("EQUITY_ISSUER=simulated — demo only; wire dinari|firstparty for live");
  if (config.isProd && config.EQUITIES_ENABLED) {
    blockers.push("EQUITIES_ENABLED prod-fatal until securities counsel + live issuer");
  }

  return {
    ready: blockers.length === 0,
    enabled: !!config.EQUITIES_ENABLED,
    issuer,
    standaloneDemo: issuer === "simulated" && !!config.EQUITIES_ENABLED,
    blockers,
    partnerOptions: ["dinari", "backed", "ondo (via issuer API)", "firstparty (Corp C)"],
  };
}
