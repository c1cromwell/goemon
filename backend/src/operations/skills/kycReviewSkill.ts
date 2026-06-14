/**
 * Phase 15.1 — KYC Review skill (the first internal agent workflow).
 *
 * Read/recommend only: the skill reads the submission, the user's history, and a
 * sanctions screen, then an advisory model recommends approve/reject/request_info.
 * Per design, a KYC tier grant is ALWAYS a human decision — the gate always escalates
 * to a compliance/admin reviewer, who sees the recommendation and decides. The grant
 * itself runs through the existing deterministic identityService.completeKycDecision;
 * the agent never grants a tier.
 */

import { config } from "../../config";
import { logger } from "../../observability/logger";
import { ensureProfile, getProfile, screenSanctions, completeKycDecision } from "../../services/identityService";
import { defineSkill } from "../skillRegistry";
import {
  registerWorkflow,
  type WorkflowDef,
  type GateDecision,
  type AgentReviewRow,
  type AdminActor,
} from "../operationsWorkflow";

export type KycRecommendation = "approve" | "reject" | "request_info";

interface KycInput {
  userId: string;
  fullName: string;
  documentNumber?: string;
}

interface KycCtx {
  subjectUserId: string;
  fullName: string;
  documentNumber?: string;
}

interface KycRec {
  recommendation: KycRecommendation;
  rationale: string;
  sanctionsClear: boolean;
}

// --- Skill toolset (read/recommend/draft only; scope: kyc:read) -------------

export const kycReviewSkill = defineSkill({
  name: "kyc-review",
  version: "1.0.0",
  tools: {
    get_kyc_submission: {
      scope: "kyc:read",
      handler: async (args) => {
        const a = (args ?? {}) as { fullName?: string; documentNumber?: string };
        return { namePresent: !!a.fullName?.trim(), hasDocument: !!a.documentNumber?.trim() };
      },
    },
    get_user_history: {
      scope: "kyc:read",
      handler: async (args) => {
        const { userId } = (args ?? {}) as { userId?: string };
        const profile = userId ? await getProfile(userId) : null;
        return { tier: profile?.tier ?? null, identity_status: profile?.identity_status ?? null };
      },
    },
    query_sanctions_databases: {
      scope: "kyc:read",
      handler: async (args) => {
        const { fullName } = (args ?? {}) as { fullName?: string };
        return screenSanctions(fullName ?? "");
      },
    },
  },
});

// --- Advisory recommendation (the only LLM-touching step) -------------------

interface RecModelInput {
  sanctionsClear: boolean;
  hasDocument: boolean;
  namePresent: boolean;
}

function recommendSimulated(i: RecModelInput): { rec: KycRec; confidence: number } {
  if (!i.sanctionsClear) {
    return {
      rec: { recommendation: "reject", rationale: "Sanctions screen returned a match.", sanctionsClear: false },
      confidence: 0.95,
    };
  }
  if (i.hasDocument && i.namePresent) {
    return {
      rec: { recommendation: "approve", rationale: "Document present and name on file; sanctions clear.", sanctionsClear: true },
      confidence: 0.85,
    };
  }
  return {
    rec: { recommendation: "request_info", rationale: "Insufficient evidence (missing document or name).", sanctionsClear: true },
    confidence: 0.5,
  };
}

const SUBMIT_TOOL = {
  name: "submit_kyc_recommendation",
  description: "Submit the structured KYC review recommendation.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendation: { type: "string", enum: ["approve", "reject", "request_info"] },
      rationale: { type: "string", description: "One-sentence justification." },
    },
    required: ["recommendation", "rationale"],
  },
};

async function recommendAnthropic(i: RecModelInput): Promise<{ rec: KycRec; confidence: number }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 256,
    system:
      "You are a KYC analyst. Given only minimized, non-identifying flags (sanctions clear, " +
      "document present, name present), recommend approve, reject, or request_info. A sanctions " +
      "match must be a reject. Always call submit_kyc_recommendation.",
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
    messages: [{ role: "user", content: JSON.stringify(i) }],
  });
  const toolUse = (message.content as Array<{ type: string; name?: string; input?: unknown }>).find(
    (b) => b.type === "tool_use" && b.name === SUBMIT_TOOL.name
  );
  if (!toolUse || typeof toolUse.input !== "object") throw new Error("no tool_use block");
  const raw = toolUse.input as { recommendation?: string; rationale?: string };
  const valid: KycRecommendation[] = ["approve", "reject", "request_info"];
  const recommendation = (valid.includes(raw.recommendation as KycRecommendation)
    ? raw.recommendation
    : "request_info") as KycRecommendation;
  // Hard guardrail: a sanctions match can never be auto-recommended as approve.
  const safe = !i.sanctionsClear ? "reject" : recommendation;
  return {
    rec: {
      recommendation: safe,
      rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 300) : "Model recommendation.",
      sanctionsClear: i.sanctionsClear,
    },
    confidence: safe === "request_info" ? 0.5 : 0.85,
  };
}

async function recommend(i: RecModelInput): Promise<{ rec: KycRec; confidence: number }> {
  if (config.OPERATIONS_ORCHESTRATOR === "anthropic" && config.ANTHROPIC_API_KEY) {
    try {
      return await recommendAnthropic(i);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "KYC recommend (anthropic) failed; using simulated fallback");
    }
  }
  return recommendSimulated(i);
}

// --- Workflow ---------------------------------------------------------------

export const kycReviewWorkflow: WorkflowDef<KycCtx, KycRec> = {
  skill: "kyc-review",
  version: "1.0.0",
  supervision: "human_required",
  scopes: ["kyc:read"],
  skillDef: kycReviewSkill,

  async gather(input) {
    const i = input as KycInput;
    if (!i?.userId) throw new Error("userId required");
    await ensureProfile(i.userId);
    return { ctx: { subjectUserId: i.userId, fullName: i.fullName ?? "", documentNumber: i.documentNumber }, subjectUserId: i.userId };
  },

  async invoke(ctx, client) {
    const submission = await client.call<{ namePresent: boolean; hasDocument: boolean }>("get_kyc_submission", {
      fullName: ctx.fullName,
      documentNumber: ctx.documentNumber,
    });
    await client.call("get_user_history", { userId: ctx.subjectUserId });
    const sanctions = await client.call<{ clear: boolean }>("query_sanctions_databases", { fullName: ctx.fullName });
    return recommend({
      sanctionsClear: sanctions.clear,
      hasDocument: submission.hasDocument,
      namePresent: submission.namePresent,
    });
  },

  // KYC tier grants are always a human decision — escalate to compliance/admin with
  // the recommendation attached. The agent never grants a tier.
  gate(_ctx, rec): GateDecision {
    return {
      action: "escalate",
      reason: rec ? `recommended:${rec.recommendation}` : "no_recommendation",
      requiresRole: ["compliance", "admin"],
    };
  },

  // The human approved — the existing deterministic grant core runs (never the agent).
  async executeApproved(review: AgentReviewRow, _actor: AdminActor) {
    if (!review.subject_user_id) throw new Error("review has no subject user");
    const profile = await getProfile(review.subject_user_id);
    if (profile && profile.tier >= 2) return; // already granted; idempotent no-op
    await completeKycDecision(review.subject_user_id, {
      tier: 2,
      riskTier: "low",
      sanctionsClear: true,
      riskScore: 0.1,
      provider: "agentic-kyc-review",
    });
  },
};

registerWorkflow(kycReviewWorkflow as WorkflowDef);
