/**
 * Phase 15.2 — remaining read-only back-office skills on the operations runner.
 *
 * All read / recommend / draft only — none execute money, state, regulator, or infra
 * actions (the §4 catalog). Postures per design §4:
 *
 *   support-response   — human_required (support); drafts a customer reply, a human sends.
 *   incident-summary   — auto_approve_audit (SRE); drafts an incident summary, humans
 *                        remediate (no deploy/restart capability exists).
 *   marketing-draft    — auto for small audiences (audited); ≥1,000 recipients or claims
 *                        escalate to admin/legal before send (send is by the notification
 *                        service, never the agent).
 *   marketplace-dd     — human_required (compliance); drafts a due-diligence record that
 *                        feeds the Phase 8 listing lifecycle.
 */

import { logAudit } from "../../services/auditService";
import { getProfile, getKycStatus } from "../../services/identityService";
import { defineSkill } from "../skillRegistry";
import {
  registerWorkflow,
  type WorkflowDef,
  type GateDecision,
  type AgentReviewRow,
  type AdminActor,
} from "../operationsWorkflow";

const MARKETING_HUMAN_THRESHOLD = 1000;

// --- Customer Support -------------------------------------------------------

export const supportSkill = defineSkill({
  name: "support",
  version: "1.0.0",
  tools: {
    get_user_kyc_status: {
      scope: "support:read",
      handler: async (a) => getKycStatus((a as { userId: string }).userId),
    },
    get_user_profile: {
      scope: "support:read",
      handler: async (a) => {
        const p = await getProfile((a as { userId: string }).userId);
        return { tier: p?.tier ?? null, status: p?.identity_status ?? null };
      },
    },
    draft_response: {
      scope: "support:draft",
      handler: async (a) => {
        const { question, tier } = (a ?? {}) as { question?: string; tier?: number | null };
        return { draft: `Thanks for reaching out. Regarding "${question ?? "your question"}": your account is Tier ${tier ?? "?"}. A specialist will confirm next steps.` };
      },
    },
  },
});

interface SupportCtx { subjectUserId: string; question: string }

export const supportResponseWorkflow: WorkflowDef<SupportCtx, { draft: string }> = {
  skill: "support-response",
  version: "1.0.0",
  supervision: "human_required",
  scopes: ["support:read", "support:draft"],
  skillDef: supportSkill,
  async gather(input) {
    const i = (input ?? {}) as { userId?: string; question?: string };
    if (!i.userId) throw new Error("userId required");
    return { ctx: { subjectUserId: i.userId, question: i.question ?? "" }, subjectUserId: i.userId };
  },
  async invoke(ctx, client) {
    const profile = await client.call<{ tier: number | null }>("get_user_profile", { userId: ctx.subjectUserId });
    const { draft } = await client.call<{ draft: string }>("draft_response", { question: ctx.question, tier: profile.tier });
    return { rec: { draft }, confidence: 0.8 };
  },
  gate(): GateDecision {
    return { action: "escalate", reason: "support_draft_ready", requiresRole: ["support", "compliance", "admin"] };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({ userId: review.subject_user_id, action: "support.response.sent", resource: review.workflow_run, details: { actorAdminId: actor.adminId } });
  },
};

// --- SRE / On-Call ----------------------------------------------------------

export const sreSkill = defineSkill({
  name: "sre",
  version: "1.0.0",
  tools: {
    query_signals: {
      scope: "sre:read",
      // Read-only summary stub — real impl reads pino logs + prom-client metrics.
      handler: async (a) => ({ service: (a as { service?: string }).service ?? "api", errorRate: 0.0, p99ms: 120 }),
    },
    draft_incident_summary: {
      scope: "sre:draft",
      handler: async (a) => {
        const s = (a ?? {}) as { service?: string; symptom?: string };
        return { summary: `Incident draft for ${s.service ?? "api"}: ${s.symptom ?? "elevated errors"}. Suggested next step: page on-call; no automated remediation performed.` };
      },
    },
  },
});

export const incidentSummaryWorkflow: WorkflowDef<{ service: string; symptom: string }, { summary: string }> = {
  skill: "incident-summary",
  version: "1.0.0",
  supervision: "auto_approve_audit", // a draft is harmless; humans remediate
  scopes: ["sre:read", "sre:draft"],
  skillDef: sreSkill,
  async gather(input) {
    const i = (input ?? {}) as { service?: string; symptom?: string };
    return { ctx: { service: i.service ?? "api", symptom: i.symptom ?? "elevated errors" } };
  },
  async invoke(ctx, client) {
    await client.call("query_signals", { service: ctx.service });
    const { summary } = await client.call<{ summary: string }>("draft_incident_summary", ctx);
    return { rec: { summary }, confidence: 0.8 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "incident_summary_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "sre.incident.summary_drafted", resource: "sre", details: { summary: rec.summary.slice(0, 120) } });
  },
};

// --- Marketing Ops ----------------------------------------------------------

export const marketingSkill = defineSkill({
  name: "marketing",
  version: "1.0.0",
  tools: {
    query_user_segments: {
      scope: "marketing:read",
      // Aggregate only — never returns PII (design §4).
      handler: async (a) => ({ segment: (a as { segment?: string }).segment ?? "all", size: (a as { size?: number }).size ?? 0 }),
    },
    draft_notification: {
      scope: "marketing:draft",
      handler: async (a) => ({ copy: `Draft notification for "${(a as { segment?: string }).segment ?? "all"}" segment.` }),
    },
  },
});

interface MarketingCtx { segment: string; audienceSize: number }

export const marketingDraftWorkflow: WorkflowDef<MarketingCtx, { copy: string; audienceSize: number }> = {
  skill: "marketing-draft",
  version: "1.0.0",
  supervision: "auto_approve_audit", // small audiences auto-pass; large escalate (gate below)
  scopes: ["marketing:read", "marketing:draft"],
  skillDef: marketingSkill,
  async gather(input) {
    const i = (input ?? {}) as { segment?: string; audienceSize?: number };
    return { ctx: { segment: i.segment ?? "all", audienceSize: i.audienceSize ?? 0 } };
  },
  async invoke(ctx, client) {
    await client.call("query_user_segments", { segment: ctx.segment, size: ctx.audienceSize });
    const { copy } = await client.call<{ copy: string }>("draft_notification", { segment: ctx.segment });
    return { rec: { copy, audienceSize: ctx.audienceSize }, confidence: 0.85 };
  },
  gate(ctx): GateDecision {
    if (ctx.audienceSize >= MARKETING_HUMAN_THRESHOLD) {
      return { action: "escalate", reason: "large_audience_requires_admin", requiresRole: ["admin"] };
    }
    return { action: "approve", reason: "small_audience_auto" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "marketing.notification.drafted", resource: "marketing", details: { audienceSize: rec.audienceSize } });
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({ action: "marketing.notification.approved", resource: review.workflow_run, details: { actorAdminId: actor.adminId } });
  },
};

// --- Marketplace Due Diligence ----------------------------------------------

export const marketplaceDdSkill = defineSkill({
  name: "marketplace-dd",
  version: "1.0.0",
  tools: {
    fetch_issuer_documents: {
      scope: "marketplace:read",
      handler: async (a) => ({ issuer: (a as { issuer?: string }).issuer ?? "unknown", documentsOnFile: true }),
    },
    draft_listing_record: {
      scope: "marketplace:draft",
      handler: async (a) => ({ record: `DD draft for ${(a as { issuer?: string }).issuer ?? "issuer"}: documents reviewed; recommend compliance sign-off.` }),
    },
  },
});

export const marketplaceDdWorkflow: WorkflowDef<{ issuer: string }, { record: string }> = {
  skill: "marketplace-dd",
  version: "1.0.0",
  supervision: "human_required",
  scopes: ["marketplace:read", "marketplace:draft"],
  skillDef: marketplaceDdSkill,
  async gather(input) {
    const i = (input ?? {}) as { issuer?: string };
    return { ctx: { issuer: i.issuer ?? "issuer" } };
  },
  async invoke(ctx, client) {
    await client.call("fetch_issuer_documents", { issuer: ctx.issuer });
    const { record } = await client.call<{ record: string }>("draft_listing_record", { issuer: ctx.issuer });
    return { rec: { record }, confidence: 0.8 };
  },
  gate(): GateDecision {
    return { action: "escalate", reason: "dd_requires_compliance", requiresRole: ["compliance", "admin"] };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({ action: "marketplace.dd.approved", resource: review.workflow_run, details: { actorAdminId: actor.adminId } });
  },
};

registerWorkflow(supportResponseWorkflow as WorkflowDef);
registerWorkflow(incidentSummaryWorkflow as WorkflowDef);
registerWorkflow(marketingDraftWorkflow as WorkflowDef);
registerWorkflow(marketplaceDdWorkflow as WorkflowDef);
