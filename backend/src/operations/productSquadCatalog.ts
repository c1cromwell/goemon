/**
 * M6 — Product squad catalog (PDLC agents).
 *
 * Maps product squad agents to runner skills. Support/SRE reuse Phase 15 skills.
 */

import type { SupervisionTier } from "./operationsWorkflow";
import type { GateOutputClass } from "./gatePolicy";

export interface ProductSquadAgentDef {
  id: string;
  name: string;
  charter: string;
  skill: string;
  supervision: SupervisionTier;
  ceoGate?: GateOutputClass;
  pdlcPhase?: "strategy" | "engineer" | "cyber" | "qa" | "orchestrator" | "builder" | "design" | "support" | "sre";
  reused?: boolean;
}

export const PRODUCT_SQUAD_AGENTS: ProductSquadAgentDef[] = [
  {
    id: "strategist",
    name: "AI Product Strategist",
    charter: "Market, positioning, strategy docs — the why.",
    skill: "product-strategy",
    supervision: "auto_approve_audit",
    pdlcPhase: "strategy",
  },
  {
    id: "engineer",
    name: "AI Engineer",
    charter: "Implementation plans, PRs, migrations.",
    skill: "product-engineer",
    supervision: "auto_approve_audit",
    pdlcPhase: "engineer",
  },
  {
    id: "cyber",
    name: "AI Cyber Specialist",
    charter: "Per-product threat modeling and security review.",
    skill: "product-cyber-review",
    supervision: "human_required",
    pdlcPhase: "cyber",
  },
  {
    id: "qa",
    name: "AI QA / Test",
    charter: "Test plans, regression, e2e gates.",
    skill: "product-qa",
    supervision: "auto_approve_audit",
    pdlcPhase: "qa",
  },
  {
    id: "orchestrator",
    name: "AI Spec / PDLC Orchestrator",
    charter: "Spec → design → build → test → launch; enforces gates.",
    skill: "pdlc-orchestrator",
    supervision: "human_required",
    ceoGate: "product_launch",
    pdlcPhase: "orchestrator",
  },
  {
    id: "agentic-builder",
    name: "AI Agentic Builder",
    charter: "Updates agents, skills, MCP servers continuously.",
    skill: "product-agentic-builder",
    supervision: "auto_approve_audit",
    pdlcPhase: "builder",
  },
  {
    id: "designer",
    name: "AI Designer / UX",
    charter: "Quiet Premium UI, accessibility.",
    skill: "product-design",
    supervision: "auto_approve_audit",
    pdlcPhase: "design",
  },
  {
    id: "support",
    name: "AI Support",
    charter: "Support issues → product KG fixes.",
    skill: "product-support-fix",
    supervision: "human_required",
    pdlcPhase: "support",
  },
  {
    id: "sre",
    name: "AI SRE / Reliability",
    charter: "SLOs, incident summaries for product surfaces.",
    skill: "incident-summary",
    supervision: "auto_approve_audit",
    pdlcPhase: "sre",
    reused: true,
  },
];

/** Ordered PDLC phases for the orchestrator pipeline. */
export const PDLC_PHASE_ORDER = ["strategy", "engineer", "cyber", "qa", "orchestrator"] as const;

export function getProductSquadAgent(id: string): ProductSquadAgentDef | undefined {
  return PRODUCT_SQUAD_AGENTS.find((a) => a.id === id);
}

export function getProductSquadAgentBySkill(skill: string): ProductSquadAgentDef | undefined {
  return PRODUCT_SQUAD_AGENTS.find((a) => a.skill === skill);
}
