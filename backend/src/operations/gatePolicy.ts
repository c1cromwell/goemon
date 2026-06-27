/**
 * M2 — CEO/CS gate policy map: (skill, output-class) → required human roles.
 *
 * Three CEO-gated output classes (Agentic OS):
 *   financial_output | product_launch | legal_signoff
 *
 * Primary gate: ceo. Backup: chief_of_staff (both listed in requires_role).
 */

import type { AdminRole } from "../middleware/rbac";
import type { GateDecision } from "./operationsWorkflow";

export type GateOutputClass = "financial_output" | "product_launch" | "legal_signoff";

export const CEO_GATE_ROLES: AdminRole[] = ["ceo", "chief_of_staff"];

/** Human-readable labels for admin UI + audit. */
export const GATE_CATEGORY_LABELS: Record<GateOutputClass, string> = {
  financial_output: "Financial output (CEO)",
  product_launch: "First production launch (CEO)",
  legal_signoff: "Final legal signoff (CEO)",
};

/** Skill name → default output class when the workflow omits outputClass on the def. */
const SKILL_OUTPUT_CLASS: Record<string, GateOutputClass> = {
  "cfo-report": "financial_output",
  "treasury-report": "financial_output",
  "clo-signoff": "legal_signoff",
  "legal-signoff": "legal_signoff",
  "compliance-filing": "legal_signoff",
  "cpo-launch": "product_launch",
  "pdlc-launch": "product_launch",
  "product-launch": "product_launch",
};

export function outputClassForSkill(skill: string): GateOutputClass | undefined {
  return SKILL_OUTPUT_CLASS[skill];
}

export function isCeoGatedOutputClass(outputClass: GateOutputClass | undefined): outputClass is GateOutputClass {
  return outputClass === "financial_output" || outputClass === "product_launch" || outputClass === "legal_signoff";
}

/** Resolve the output class from workflow def, gate decision, or skill registry. */
export function resolveOutputClass(
  skill: string,
  defClass?: GateOutputClass,
  decisionClass?: GateOutputClass
): GateOutputClass | undefined {
  return decisionClass ?? defClass ?? outputClassForSkill(skill);
}

/**
 * CEO-gated outputs never auto-execute — escalate to ceo + chief_of_staff backup.
 */
export function applyCeoGatePolicy(
  skill: string,
  defOutputClass: GateOutputClass | undefined,
  decision: GateDecision
): GateDecision {
  const outputClass = resolveOutputClass(skill, defOutputClass, decision.outputClass);
  if (!isCeoGatedOutputClass(outputClass)) return decision;

  if (decision.action === "reject") {
    return { ...decision, outputClass, requiresRole: decision.requiresRole ?? CEO_GATE_ROLES };
  }

  return {
    action: "escalate",
    reason: decision.action === "escalate" ? decision.reason : `ceo_gate:${outputClass}`,
    requiresRole: CEO_GATE_ROLES,
    dueInHours: decision.dueInHours,
    outputClass,
  };
}

export function actorCanResolveReview(actorRole: AdminRole, requiresRoleCsv: string): boolean {
  const allowed = requiresRoleCsv.split(",").map((r) => r.trim()).filter(Boolean);
  if (allowed.includes(actorRole)) return true;
  // Legacy super-admin may resolve compliance gates only — not CEO gates unless listed.
  if (actorRole === "admin" && allowed.every((r) => r !== "ceo")) {
    return allowed.includes("admin") || allowed.includes("compliance");
  }
  return false;
}
