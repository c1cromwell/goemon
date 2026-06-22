/**
 * Mechanical governance for high-stakes LLM decisions — TypeScript seam inspired by
 * SantanderAI/mech-gov-framework (Apache-2.0). Wraps Phase 15 gate decisions with
 * R1/R2/R3 regimes and hard escalation rules before money-impacting execution.
 *
 * R1 — advisory only (log + metrics)
 * R2 — hard gate: low confidence or high-risk skill → always escalate
 * R3 — commit-reveal style: dual-check for compliance/KYC (human_required minimum)
 */

import { config } from "../config";
import type { GateDecision } from "../operations/operationsWorkflow";
import { agentEscalationTotal } from "../observability/metrics";

export type GovRegime = "R1" | "R2" | "R3";

const HIGH_RISK_SKILLS = new Set(["kyc-review", "compliance-filing"]);

export interface MechGovInput {
  skill: string;
  confidence: number;
  regime?: GovRegime;
  gate: GateDecision;
}

export interface MechGovOutcome {
  gate: GateDecision;
  regime: GovRegime;
  escalated: boolean;
  reason?: string;
}

function defaultRegime(skill: string): GovRegime {
  if (HIGH_RISK_SKILLS.has(skill)) return "R3";
  if (skill.startsWith("compliance") || skill.startsWith("kyc")) return "R2";
  return "R1";
}

/** Apply mechanical governance overlay to a deterministic gate decision. */
export function applyMechanicalGovernance(input: MechGovInput): MechGovOutcome {
  if (!config.MECH_GOV_ENABLED) {
    return { gate: input.gate, regime: input.regime ?? "R1", escalated: false };
  }

  const regime = input.regime ?? defaultRegime(input.skill);
  let gate = input.gate;
  let escalated = false;
  let reason: string | undefined;

  const floor = config.OPERATIONS_REVIEW_FLOOR;

  if (regime === "R3") {
    if (gate.action === "approve") {
      gate = { action: "escalate", reason: "R3 regime requires human gate", requiresRole: gate.requiresRole ?? ["compliance", "admin"] };
      escalated = true;
      reason = "R3";
    }
  } else if (regime === "R2") {
    if (gate.action === "approve" && input.confidence < floor + 0.2) {
      gate = { action: "escalate", reason: `R2 confidence ${input.confidence} below elevated floor`, requiresRole: gate.requiresRole ?? ["compliance", "admin"] };
      escalated = true;
      reason = "R2-confidence";
    }
  }

  if (escalated) {
    agentEscalationTotal.inc({ skill: input.skill, reason: reason ?? "mech-gov" });
  }

  return { gate, regime, escalated, reason };
}
