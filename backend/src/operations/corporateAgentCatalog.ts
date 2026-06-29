/**
 * M5 — Corporate agent fleet catalog (C-suite brain).
 *
 * Maps Agentic OS corporate agents to runner skills. Some agents reuse existing
 * Phase 15 skills (CMO → marketing-draft, CRO → compliance, COO → incident-summary).
 */

import type { SupervisionTier } from "./operationsWorkflow";
import type { GateOutputClass } from "./gatePolicy";

export interface CorporateAgentDef {
  id: string;
  name: string;
  charter: string;
  skill: string;
  supervision: SupervisionTier;
  ceoGate?: GateOutputClass;
  /** True when the workflow lives in another skills module. */
  reused?: boolean;
}

export const CORPORATE_AGENTS: CorporateAgentDef[] = [
  {
    id: "goemon-brain",
    name: "Goemon Brain",
    charter: "Office of CEO — routes work, convenes agents, owns the approval queue.",
    skill: "goemon-brain-route",
    supervision: "human_led",
  },
  {
    id: "cfo",
    name: "CFO",
    charter: "Budgets, treasury, revenue and spend reporting.",
    skill: "cfo-report",
    supervision: "human_required",
    ceoGate: "financial_output",
  },
  {
    id: "clo",
    name: "CLO",
    charter: "Legal/regulatory posture, counsel memo drafts, filing prep.",
    skill: "clo-signoff",
    supervision: "human_required",
    ceoGate: "legal_signoff",
  },
  {
    id: "ciso",
    name: "CISO",
    charter: "Corporate security posture; peers with product Cyber Specialist.",
    skill: "ciso-posture",
    supervision: "auto_approve_audit",
  },
  {
    id: "cpo",
    name: "CPO",
    charter: "Product portfolio, roadmap, launch readiness.",
    skill: "cpo-launch",
    supervision: "human_required",
    ceoGate: "product_launch",
  },
  {
    id: "cmo",
    name: "CMO",
    charter: "Brand, positioning, GTM.",
    skill: "marketing-draft",
    supervision: "auto_approve_audit",
    reused: true,
  },
  {
    id: "cro",
    name: "CRO / Compliance",
    charter: "Risk, audit, regulatory filings.",
    skill: "sanctions-rescreen",
    supervision: "human_required",
    reused: true,
  },
  {
    id: "coo",
    name: "COO / SRE",
    charter: "Infrastructure, vendors, reliability.",
    skill: "incident-summary",
    supervision: "auto_approve_audit",
    reused: true,
  },
];

export interface RoutePlan {
  targetSkill: string;
  targetInput: Record<string, unknown>;
  rationale: string;
  agentId: string;
  confidence: number;
}

/** Deterministic intent → corporate skill routing (no LLM). */
export function resolveCorporateIntent(intent: string, payload: Record<string, unknown> = {}): RoutePlan {
  const key = intent.trim().toLowerCase();

  if (/financial|treasury|budget|revenue|spend|fbo/.test(key)) {
    return {
      agentId: "cfo",
      targetSkill: "cfo-report",
      targetInput: { period: payload.period ?? "monthly", currency: payload.currency ?? "USD" },
      rationale: "Financial/treasury intent → CFO report workflow.",
      confidence: 0.9,
    };
  }
  if (/legal|counsel|signoff|memo|regulatory/.test(key)) {
    return {
      agentId: "clo",
      targetSkill: "clo-signoff",
      targetInput: { topic: payload.topic ?? intent, jurisdiction: payload.jurisdiction ?? "US" },
      rationale: "Legal/regulatory intent → CLO signoff workflow.",
      confidence: 0.88,
    };
  }
  if (/launch|product|release|ship/.test(key)) {
    return {
      agentId: "cpo",
      targetSkill: "cpo-launch",
      targetInput: { product: payload.product ?? "unnamed", version: payload.version ?? "1.0.0" },
      rationale: "Launch intent → CPO launch readiness workflow.",
      confidence: 0.92,
    };
  }
  if (/security|posture|ciso|threat/.test(key)) {
    return {
      agentId: "ciso",
      targetSkill: "ciso-posture",
      targetInput: { scope: payload.scope ?? "corporate" },
      rationale: "Security posture intent → CISO workflow.",
      confidence: 0.85,
    };
  }
  if (/marketing|gtm|brand|campaign/.test(key)) {
    return {
      agentId: "cmo",
      targetSkill: "marketing-draft",
      targetInput: { segment: payload.segment ?? "all", audienceSize: payload.audienceSize ?? 100 },
      rationale: "Marketing intent → CMO draft workflow.",
      confidence: 0.8,
    };
  }
  if (/filing|sar|ofac|ctr/.test(key)) {
    return {
      agentId: "cro",
      targetSkill: "compliance-filing",
      targetInput: {
        filingType: payload.filingType ?? "SAR",
        subjectRef: payload.subjectRef ?? "case-1",
        summary: payload.summary ?? intent,
      },
      rationale: "Regulatory filing intent → compliance filing workflow.",
      confidence: 0.87,
    };
  }
  if (/sanctions|compliance|kyc|screen/.test(key)) {
    return {
      agentId: "cro",
      targetSkill: payload.userId ? "sanctions-rescreen" : "kyc-review",
      targetInput: payload.userId
        ? { userId: payload.userId, fullName: payload.fullName ?? "Unknown" }
        : { userId: payload.userId ?? "demo-user", fullName: payload.fullName ?? "Demo User" },
      rationale: "Compliance intent → sanctions/KYC workflow.",
      confidence: 0.86,
    };
  }
  if (/incident|sre|outage|reliability/.test(key)) {
    return {
      agentId: "coo",
      targetSkill: "incident-summary",
      targetInput: { service: payload.service ?? "api", symptom: payload.symptom ?? intent },
      rationale: "Reliability intent → COO/SRE incident summary workflow.",
      confidence: 0.84,
    };
  }

  return {
    agentId: "goemon-brain",
    targetSkill: "cfo-report",
    targetInput: { period: "monthly", note: intent },
    rationale: `Unrecognized intent "${intent}" — defaulting to CFO monthly report for human review.`,
    confidence: 0.4,
  };
}

export function getCorporateAgent(id: string): CorporateAgentDef | undefined {
  return CORPORATE_AGENTS.find((a) => a.id === id);
}

export function getCorporateAgentBySkill(skill: string): CorporateAgentDef | undefined {
  return CORPORATE_AGENTS.find((a) => a.skill === skill);
}
