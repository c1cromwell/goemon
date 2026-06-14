/**
 * Phase 15.3 — Compliance reporting skills (read / recommend / draft only).
 *
 * Two workflows on the operations runner, both honoring the one invariant (agents
 * draft/recommend; a deterministic, RBAC-checked, audited human gate acts):
 *
 *   sanctions-rescreen  — re-screens a user. A confirmed match escalates to compliance
 *                         with a 10-day OFAC deadline and a freeze recommendation;
 *                         on human approval the existing accountHoldService freezes the
 *                         account (the agent never freezes). A clean screen auto-passes
 *                         (audited).
 *   compliance-filing   — drafts a regulatory filing (SAR 30d / OFAC 10d / CTR 15d) and
 *                         escalates to compliance with that deadline. Every filing is
 *                         human-filed by policy; executeApproved records the filing event
 *                         (no real regulator submission — out of scope).
 *
 * Deadlines are encoded as GateDecision.dueInHours and surfaced via
 * /api/admin/agent-ops/reviews/overdue.
 */

import { logAudit } from "../../services/auditService";
import { ensureProfile, screenSanctions } from "../../services/identityService";
import { placeHold } from "../../services/accountHoldService";
import { defineSkill } from "../skillRegistry";
import {
  registerWorkflow,
  type WorkflowDef,
  type GateDecision,
  type AgentReviewRow,
  type AdminActor,
} from "../operationsWorkflow";

// Regulatory SLAs in hours (design §6).
export const FILING_DEADLINE_HOURS: Record<string, number> = {
  SAR: 30 * 24,
  OFAC: 10 * 24,
  CTR: 15 * 24,
};
const SANCTIONS_OFAC_HOURS = 10 * 24;

export const complianceSkill = defineSkill({
  name: "compliance",
  version: "1.0.0",
  tools: {
    query_sanctions_databases: {
      scope: "compliance:read",
      handler: async (args) => screenSanctions(((args ?? {}) as { fullName?: string }).fullName ?? ""),
    },
    // "draft" tool — produces a narrative for a human to review/file. Deterministic
    // template here; the anthropic draft plugs in at the same seam as the KYC skill.
    draft_filing_narrative: {
      scope: "compliance:draft",
      handler: async (args) => {
        const a = (args ?? {}) as { filingType?: string; subjectRef?: string; summary?: string };
        return {
          narrative:
            `${a.filingType ?? "FILING"} draft for ${a.subjectRef ?? "subject"}: ${a.summary ?? "see attached evidence"}. ` +
            `Prepared by automated triage; requires compliance review before filing.`,
        };
      },
    },
  },
});

// --- sanctions-rescreen -----------------------------------------------------

interface RescreenCtx { subjectUserId: string; fullName: string }
interface RescreenRec { match: boolean; recommendation: "freeze_and_report" | "clear" }

export const sanctionsRescreenWorkflow: WorkflowDef<RescreenCtx, RescreenRec> = {
  skill: "sanctions-rescreen",
  version: "1.0.0",
  supervision: "auto_approve_audit", // a clean screen auto-passes (audited); a hit escalates
  scopes: ["compliance:read"],
  skillDef: complianceSkill,

  async gather(input) {
    const i = (input ?? {}) as { userId?: string; fullName?: string };
    if (!i.userId) throw new Error("userId required");
    await ensureProfile(i.userId);
    return { ctx: { subjectUserId: i.userId, fullName: i.fullName ?? "" }, subjectUserId: i.userId };
  },

  async invoke(ctx, client) {
    const { clear } = await client.call<{ clear: boolean }>("query_sanctions_databases", { fullName: ctx.fullName });
    return {
      rec: { match: !clear, recommendation: clear ? "clear" : "freeze_and_report" },
      confidence: 0.95,
    };
  },

  gate(_ctx, rec): GateDecision {
    if (rec?.match) {
      // Confirmed match → compliance must confirm the freeze + OFAC report within 10 days.
      return { action: "escalate", reason: "sanctions_match", requiresRole: ["compliance", "admin"], dueInHours: SANCTIONS_OFAC_HOURS };
    }
    return { action: "approve", reason: "sanctions_clear" }; // auto, audited
  },

  async execute(ctx) {
    await logAudit({ userId: ctx.subjectUserId, action: "compliance.sanctions.clear", resource: ctx.subjectUserId });
  },

  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    if (!review.subject_user_id) throw new Error("review has no subject user");
    // The human (compliance) confirmed the match — freeze via the existing deterministic
    // hold service (the agent never freezes), idempotent on the review id.
    await placeHold({
      userId: review.subject_user_id,
      reason: "OFAC sanctions match confirmed (compliance review)",
      source: "compliance",
      decisionId: review.id,
    });
    await logAudit({
      userId: review.subject_user_id,
      action: "compliance.ofac.report.filed",
      resource: review.workflow_run,
      details: { actorAdminId: actor.adminId, reviewId: review.id },
    });
  },
};

// --- compliance-filing (SAR / OFAC / CTR) -----------------------------------

interface FilingCtx { subjectUserId?: string; filingType: string; subjectRef: string; summary?: string }
interface FilingRec { filingType: string; narrative: string }

export const complianceFilingWorkflow: WorkflowDef<FilingCtx, FilingRec> = {
  skill: "compliance-filing",
  version: "1.0.0",
  supervision: "human_required", // every filing is human-filed
  scopes: ["compliance:read", "compliance:draft"],
  skillDef: complianceSkill,

  async gather(input) {
    const i = (input ?? {}) as { userId?: string; filingType?: string; subjectRef?: string; summary?: string };
    const filingType = (i.filingType ?? "SAR").toUpperCase();
    if (!FILING_DEADLINE_HOURS[filingType]) throw new Error(`Unknown filingType ${filingType}`);
    return {
      ctx: { subjectUserId: i.userId, filingType, subjectRef: i.subjectRef ?? i.userId ?? "subject", summary: i.summary },
      subjectUserId: i.userId,
    };
  },

  async invoke(ctx, client) {
    const { narrative } = await client.call<{ narrative: string }>("draft_filing_narrative", {
      filingType: ctx.filingType, subjectRef: ctx.subjectRef, summary: ctx.summary,
    });
    return { rec: { filingType: ctx.filingType, narrative }, confidence: 0.9 };
  },

  gate(ctx): GateDecision {
    return {
      action: "escalate",
      reason: `draft_${ctx.filingType.toLowerCase()}`,
      requiresRole: ["compliance", "admin"],
      dueInHours: FILING_DEADLINE_HOURS[ctx.filingType],
    };
  },

  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    const rec = JSON.parse(review.recommendation) as Partial<FilingRec>;
    // Human-filed by policy — we record the filing event, never auto-submit to a regulator.
    await logAudit({
      userId: review.subject_user_id,
      action: "compliance.filing.filed",
      resource: review.workflow_run,
      details: { filingType: rec.filingType, actorAdminId: actor.adminId, reviewId: review.id },
    });
  },
};

registerWorkflow(sanctionsRescreenWorkflow as WorkflowDef);
registerWorkflow(complianceFilingWorkflow as WorkflowDef);
