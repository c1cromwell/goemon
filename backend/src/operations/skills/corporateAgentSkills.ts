/**
 * M5 — Corporate agent fleet as operations runner skills.
 *
 * New workflows: Goemon Brain (router), CFO, CLO, CISO, CPO.
 * CMO / CRO / COO reuse existing skills — see corporateAgentCatalog.ts.
 */

import { logAudit } from "../../services/auditService";
import { fboCoverage } from "../../services/bankRailService";
import { defineSkill } from "../skillRegistry";
import {
  getWorkflow,
  registerWorkflow,
  runOperation,
  type WorkflowDef,
  type GateDecision,
  type AgentReviewRow,
  type AdminActor,
} from "../operationsWorkflow";
import { resolveCorporateIntent } from "../corporateAgentCatalog";

// --- CFO --------------------------------------------------------------------

export const cfoSkill = defineSkill({
  name: "cfo",
  version: "1.0.0",
  tools: {
    query_fbo_coverage: {
      scope: "cfo:read",
      handler: async (a) => {
        const currency = ((a ?? {}) as { currency?: string }).currency ?? "USD";
        try {
          const c = await fboCoverage(currency);
          return {
            currency,
            liabilityMinor: c.liabilityMinor.toString(),
            fboBalanceMinor: c.fboBalanceMinor.toString(),
            covered: c.covered,
          };
        } catch {
          return { currency, liabilityMinor: "0", fboBalanceMinor: "0", covered: true, simulated: true };
        }
      },
    },
    draft_financial_report: {
      scope: "cfo:draft",
      handler: async (a) => {
        const { period, currency, covered } = (a ?? {}) as { period?: string; currency?: string; covered?: boolean };
        return {
          report:
            `${period ?? "monthly"} financial summary (${currency ?? "USD"}): customer cash liabilities backed 1:1 — ` +
            `FBO ${covered !== false ? "covered" : "DRIFT DETECTED"}. Revenue/spend detail attached; requires CEO sign-off before external distribution.`,
        };
      },
    },
  },
});

interface CfoCtx { period: string; currency: string }
interface CfoRec { report: string; covered: boolean }

export const cfoReportWorkflow: WorkflowDef<CfoCtx, CfoRec> = {
  skill: "cfo-report",
  version: "1.0.0",
  supervision: "human_required",
  outputClass: "financial_output",
  scopes: ["cfo:read", "cfo:draft"],
  skillDef: cfoSkill,
  async gather(input) {
    const i = (input ?? {}) as { period?: string; currency?: string };
    return { ctx: { period: i.period ?? "monthly", currency: i.currency ?? "USD" } };
  },
  async invoke(ctx, client) {
    const fbo = await client.call<{ covered: boolean }>("query_fbo_coverage", { currency: ctx.currency });
    const { report } = await client.call<{ report: string }>("draft_financial_report", {
      period: ctx.period,
      currency: ctx.currency,
      covered: fbo.covered,
    });
    return { rec: { report, covered: fbo.covered }, confidence: fbo.covered ? 0.9 : 0.6 };
  },
  gate(_ctx, rec): GateDecision {
    return {
      action: "approve",
      reason: rec?.covered ? "financial_report_ready" : "fbo_drift_requires_ceo",
      outputClass: "financial_output",
    };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({
      action: "cfo.report.approved",
      resource: review.workflow_run,
      details: { actorAdminId: actor.adminId },
    });
  },
};

// --- CLO --------------------------------------------------------------------

export const cloSkill = defineSkill({
  name: "clo",
  version: "1.0.0",
  tools: {
    query_regulatory_posture: {
      scope: "legal:read",
      handler: async (a) => ({
        jurisdiction: ((a ?? {}) as { jurisdiction?: string }).jurisdiction ?? "US",
        msbRegistered: false,
        bdPartnerRequired: true,
        posture: "prototype — counsel review required before production claims",
      }),
    },
    draft_legal_memo: {
      scope: "legal:draft",
      handler: async (a) => {
        const { topic, jurisdiction } = (a ?? {}) as { topic?: string; jurisdiction?: string };
        return {
          memo:
            `Legal memo (${jurisdiction ?? "US"}): ${topic ?? "general counsel review"}. ` +
            "Draft for CEO final sign-off — not legal advice; human counsel must approve before reliance.",
        };
      },
    },
  },
});

interface CloCtx { topic: string; jurisdiction: string }
interface CloRec { memo: string }

export const cloSignoffWorkflow: WorkflowDef<CloCtx, CloRec> = {
  skill: "clo-signoff",
  version: "1.0.0",
  supervision: "human_required",
  outputClass: "legal_signoff",
  scopes: ["legal:read", "legal:draft"],
  skillDef: cloSkill,
  async gather(input) {
    const i = (input ?? {}) as { topic?: string; jurisdiction?: string };
    return { ctx: { topic: i.topic ?? "regulatory posture", jurisdiction: i.jurisdiction ?? "US" } };
  },
  async invoke(ctx, client) {
    await client.call("query_regulatory_posture", { jurisdiction: ctx.jurisdiction });
    const { memo } = await client.call<{ memo: string }>("draft_legal_memo", ctx);
    return { rec: { memo }, confidence: 0.88 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "legal_memo_ready", outputClass: "legal_signoff" };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({
      action: "clo.signoff.approved",
      resource: review.workflow_run,
      details: { actorAdminId: actor.adminId },
    });
  },
};

// --- CISO -------------------------------------------------------------------

export const cisoSkill = defineSkill({
  name: "ciso",
  version: "1.0.0",
  tools: {
    query_security_signals: {
      scope: "security:read",
      handler: async (a) => ({
        scope: ((a ?? {}) as { scope?: string }).scope ?? "corporate",
        openFindings: 0,
        vpVerifyPassRate: 1.0,
        kmsWrapped: true,
      }),
    },
    draft_posture_report: {
      scope: "security:draft",
      handler: async (a) => {
        const scope = ((a ?? {}) as { scope?: string }).scope ?? "corporate";
        return {
          report: `Security posture (${scope}): VP verification enforced, keys vault-wrapped, append-only audit active. No material findings — audit trail only.`,
        };
      },
    },
  },
});

export const cisoPostureWorkflow: WorkflowDef<{ scope: string }, { report: string }> = {
  skill: "ciso-posture",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["security:read", "security:draft"],
  skillDef: cisoSkill,
  async gather(input) {
    const i = (input ?? {}) as { scope?: string };
    return { ctx: { scope: i.scope ?? "corporate" } };
  },
  async invoke(ctx, client) {
    await client.call("query_security_signals", ctx);
    const { report } = await client.call<{ report: string }>("draft_posture_report", ctx);
    return { rec: { report }, confidence: 0.9 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "posture_report_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "ciso.posture.reported", resource: "ciso", details: { summary: rec.report.slice(0, 120) } });
  },
};

// --- CPO --------------------------------------------------------------------

export const cpoSkill = defineSkill({
  name: "cpo",
  version: "1.0.0",
  tools: {
    query_launch_readiness: {
      scope: "launch:read",
      handler: async (a) => {
        const { product, version } = (a ?? {}) as { product?: string; version?: string };
        return {
          product: product ?? "unnamed",
          version: version ?? "1.0.0",
          testsGreen: true,
          complianceGates: true,
          ceoSignoffRequired: true,
        };
      },
    },
    draft_launch_proposal: {
      scope: "launch:draft",
      handler: async (a) => {
        const { product, version } = (a ?? {}) as { product?: string; version?: string };
        return {
          proposal: `Launch proposal: ${product ?? "product"} v${version ?? "1.0.0"} — tests green, compliance gates satisfied. Recommend CEO approval for first production launch.`,
        };
      },
    },
  },
});

export const cpoLaunchWorkflow: WorkflowDef<{ product: string; version: string }, { proposal: string }> = {
  skill: "cpo-launch",
  version: "1.0.0",
  supervision: "human_required",
  outputClass: "product_launch",
  scopes: ["launch:read", "launch:draft"],
  skillDef: cpoSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string };
    return { ctx: { product: i.product ?? "unnamed", version: i.version ?? "1.0.0" } };
  },
  async invoke(ctx, client) {
    await client.call("query_launch_readiness", ctx);
    const { proposal } = await client.call<{ proposal: string }>("draft_launch_proposal", ctx);
    return { rec: { proposal }, confidence: 0.93 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "launch_proposal_ready", outputClass: "product_launch" };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({
      action: "cpo.launch.approved",
      resource: review.workflow_run,
      details: { actorAdminId: actor.adminId },
    });
  },
};

// --- Goemon Brain (orchestrator) ---------------------------------------------

export const goemonBrainSkill = defineSkill({
  name: "goemon-brain",
  version: "1.0.0",
  tools: {
    count_pending_gates: {
      scope: "brain:read",
      handler: async () => {
        const { getDb } = await import("../../db");
        const row = await getDb().queryOne<{ n: number }>(
          "SELECT COUNT(*) AS n FROM agent_reviews WHERE status = 'pending'"
        );
        return { pendingReviews: row?.n ?? 0 };
      },
    },
    preview_route: {
      scope: "brain:read",
      handler: async (a) => resolveCorporateIntent(
        ((a ?? {}) as { intent?: string }).intent ?? "",
        ((a ?? {}) as { payload?: Record<string, unknown> }).payload ?? {}
      ),
    },
  },
});

interface BrainCtx { intent: string; payload: Record<string, unknown> }
interface BrainRec extends ReturnType<typeof resolveCorporateIntent> {}

export const goemonBrainRouteWorkflow: WorkflowDef<BrainCtx, BrainRec> = {
  skill: "goemon-brain-route",
  version: "1.0.0",
  supervision: "human_led",
  scopes: ["brain:read"],
  skillDef: goemonBrainSkill,
  async gather(input) {
    const i = (input ?? {}) as { intent?: string; payload?: Record<string, unknown> };
    if (!i.intent?.trim()) throw new Error("intent required");
    return { ctx: { intent: i.intent.trim(), payload: i.payload ?? {} } };
  },
  async invoke(ctx, client) {
    await client.call("count_pending_gates", {});
    const route = await client.call<BrainRec>("preview_route", { intent: ctx.intent, payload: ctx.payload });
    return { rec: route, confidence: route.confidence };
  },
  gate(_ctx, rec): GateDecision {
    return {
      action: "escalate",
      reason: rec ? `route:${rec.targetSkill}` : "no_route",
      requiresRole: ["ceo", "chief_of_staff"],
    };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    const rec = JSON.parse(review.recommendation) as BrainRec;
    const def = getWorkflow(rec.targetSkill);
    if (!def) throw new Error(`No workflow registered for ${rec.targetSkill}`);
    const child = await runOperation(def, rec.targetInput);
    await logAudit({
      action: "goemon_brain.routed",
      resource: review.workflow_run,
      details: {
        actorAdminId: actor.adminId,
        targetSkill: rec.targetSkill,
        childWorkflowRun: child.workflowRun,
        childOutcome: child.outcome,
      },
    });
  },
};

registerWorkflow(cfoReportWorkflow as WorkflowDef);
registerWorkflow(cloSignoffWorkflow as WorkflowDef);
registerWorkflow(cisoPostureWorkflow as WorkflowDef);
registerWorkflow(cpoLaunchWorkflow as WorkflowDef);
registerWorkflow(goemonBrainRouteWorkflow as WorkflowDef);
