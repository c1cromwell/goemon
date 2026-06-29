/**
 * M6 — Product squad skills + PDLC orchestrator on the operations runner.
 *
 * PDLC flow: Strategist → Engineer + Cyber (parallel) → QA → Orchestrator launch
 * proposal → CEO gate → product KG (Launch + Product + Strategy).
 */

import { logAudit } from "../../services/auditService";
import { recordPdlcLaunch, recordSupportFix } from "../../services/decisionGraphService";
import { defineSkill } from "../skillRegistry";
import {
  registerWorkflow,
  type WorkflowDef,
  type GateDecision,
  type AgentReviewRow,
  type AdminActor,
} from "../operationsWorkflow";

// --- Shared product skill (tools reused across squad workflows) ----------------

export const productSquadSkill = defineSkill({
  name: "product-squad",
  version: "1.0.0",
  tools: {
    draft_strategy: {
      scope: "product:draft",
      handler: async (a) => {
        const { product, summary } = (a ?? {}) as { product?: string; summary?: string };
        return {
          strategy: `Strategy for ${product ?? "product"}: ${summary ?? "differentiated tokenization-first finance"}. Target: agent-native users seeking non-custodial control.`,
        };
      },
    },
    draft_engineering_plan: {
      scope: "product:draft",
      handler: async (a) => {
        const { product, version } = (a ?? {}) as { product?: string; version?: string };
        return {
          plan: `Engineering plan — ${product ?? "product"} v${version ?? "1.0"}: migrations, API routes, frontend pages, vitest coverage. No money-path changes without ledger review.`,
        };
      },
    },
    draft_cyber_review: {
      scope: "product:draft",
      handler: async (a) => {
        const { product } = (a ?? {}) as { product?: string };
        return {
          review: `Cyber review (${product ?? "product"}): VP-before-access enforced, scoped MCP tokens, append-only audit. Material finding: none — proceed with launch checklist.`,
          materialFinding: false,
        };
      },
    },
    draft_qa_plan: {
      scope: "product:draft",
      handler: async (a) => {
        const { product } = (a ?? {}) as { product?: string };
        return {
          qaPlan: `QA plan for ${product ?? "product"}: unit + e2e validator, SmartChat/MCP harness, money invariants. Regression gate required before launch.`,
          testsGreen: true,
        };
      },
    },
    draft_design_notes: {
      scope: "product:draft",
      handler: async (a) => {
        const { product } = (a ?? {}) as { product?: string };
        return {
          design: `UX notes (${product ?? "product"}): Quiet Premium — monochrome + jade accent, type-led hierarchy, passkey-first, formatMoney for all amounts.`,
        };
      },
    },
    draft_agentic_updates: {
      scope: "product:draft",
      handler: async (a) => {
        const { product } = (a ?? {}) as { product?: string };
        return {
          updates: `Agentic Builder (${product ?? "product"}): register new MCP tools, extend skill scopes, update Agentic OS webview cards — no auto-deploy of money skills.`,
        };
      },
    },
    compile_launch_proposal: {
      scope: "product:draft",
      handler: async (a) => {
        const ctx = (a ?? {}) as {
          product?: string;
          version?: string;
          strategy?: string;
          plan?: string;
          review?: string;
          qaPlan?: string;
        };
        return {
          proposal:
            `Launch proposal: ${ctx.product ?? "product"} v${ctx.version ?? "1.0"}\n` +
            `Strategy: ${ctx.strategy ?? "—"}\n` +
            `Engineering: ${ctx.plan ?? "—"}\n` +
            `Security: ${ctx.review ?? "—"}\n` +
            `QA: ${ctx.qaPlan ?? "—"}\n` +
            "Recommend CEO approval for first production launch.",
        };
      },
    },
  },
});

// --- Individual squad workflows (runnable standalone) -------------------------

interface ProductCtx {
  product: string;
  version: string;
  summary: string;
}

export const productStrategyWorkflow: WorkflowDef<ProductCtx, { strategy: string }> = {
  skill: "product-strategy",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const { strategy } = await client.call<{ strategy: string }>("draft_strategy", ctx);
    return { rec: { strategy }, confidence: 0.88 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "strategy_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "product.strategy.drafted", resource: "product", details: { summary: rec.strategy.slice(0, 120) } });
  },
};

export const productEngineerWorkflow: WorkflowDef<ProductCtx, { plan: string }> = {
  skill: "product-engineer",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const { plan } = await client.call<{ plan: string }>("draft_engineering_plan", ctx);
    return { rec: { plan }, confidence: 0.9 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "engineering_plan_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "product.engineering.drafted", resource: "product", details: { plan: rec.plan.slice(0, 120) } });
  },
};

export const productCyberWorkflow: WorkflowDef<ProductCtx, { review: string; materialFinding: boolean }> = {
  skill: "product-cyber-review",
  version: "1.0.0",
  supervision: "human_required",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const out = await client.call<{ review: string; materialFinding: boolean }>("draft_cyber_review", ctx);
    return { rec: out, confidence: out.materialFinding ? 0.4 : 0.92 };
  },
  gate(_ctx, rec): GateDecision {
    if (rec?.materialFinding) {
      return { action: "escalate", reason: "material_security_finding", requiresRole: ["compliance", "admin", "ceo"] };
    }
    return { action: "escalate", reason: "cyber_review_complete", requiresRole: ["compliance", "admin"] };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    await logAudit({ action: "product.cyber.approved", resource: review.workflow_run, details: { actorAdminId: actor.adminId } });
  },
};

export const productQaWorkflow: WorkflowDef<ProductCtx, { qaPlan: string; testsGreen: boolean }> = {
  skill: "product-qa",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const out = await client.call<{ qaPlan: string; testsGreen: boolean }>("draft_qa_plan", ctx);
    return { rec: out, confidence: out.testsGreen ? 0.91 : 0.5 };
  },
  gate(_ctx, rec): GateDecision {
    return rec?.testsGreen
      ? { action: "approve", reason: "qa_plan_green" }
      : { action: "reject", reason: "tests_not_green" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "product.qa.drafted", resource: "product", details: { qaPlan: rec.qaPlan.slice(0, 120) } });
  },
};

export const productDesignWorkflow: WorkflowDef<ProductCtx, { design: string }> = {
  skill: "product-design",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const { design } = await client.call<{ design: string }>("draft_design_notes", ctx);
    return { rec: { design }, confidence: 0.87 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "design_notes_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "product.design.drafted", resource: "product", details: { design: rec.design.slice(0, 120) } });
  },
};

export const productAgenticBuilderWorkflow: WorkflowDef<ProductCtx, { updates: string }> = {
  skill: "product-agentic-builder",
  version: "1.0.0",
  supervision: "auto_approve_audit",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    return { ctx: { product: i.product ?? "Goeman", version: i.version ?? "1.0", summary: i.summary ?? "" } };
  },
  async invoke(ctx, client) {
    const { updates } = await client.call<{ updates: string }>("draft_agentic_updates", ctx);
    return { rec: { updates }, confidence: 0.86 };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "agentic_updates_drafted" };
  },
  async execute(_ctx, rec) {
    await logAudit({ action: "product.agentic_builder.drafted", resource: "product", details: { updates: rec.updates.slice(0, 120) } });
  },
};

// --- PDLC orchestrator (full pipeline → CEO launch gate) ----------------------

interface PdlcRec {
  product: string;
  version: string;
  strategy: string;
  plan: string;
  review: string;
  qaPlan: string;
  proposal: string;
}

export const pdlcOrchestratorWorkflow: WorkflowDef<ProductCtx, PdlcRec> = {
  skill: "pdlc-orchestrator",
  version: "1.0.0",
  supervision: "human_required",
  outputClass: "product_launch",
  scopes: ["product:draft"],
  skillDef: productSquadSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; version?: string; summary?: string };
    if (!i.product?.trim()) throw new Error("product required");
    return {
      ctx: {
        product: i.product.trim(),
        version: i.version ?? "1.0.0",
        summary: i.summary ?? "PDLC launch cycle",
      },
    };
  },
  async invoke(ctx, client) {
    const { strategy } = await client.call<{ strategy: string }>("draft_strategy", ctx);
    const { plan } = await client.call<{ plan: string }>("draft_engineering_plan", ctx);
    const { review } = await client.call<{ review: string }>("draft_cyber_review", ctx);
    const { qaPlan } = await client.call<{ qaPlan: string }>("draft_qa_plan", ctx);
    const { proposal } = await client.call<{ proposal: string }>("compile_launch_proposal", {
      ...ctx,
      strategy,
      plan,
      review,
      qaPlan,
    });
    return {
      rec: { product: ctx.product, version: ctx.version, strategy, plan, review, qaPlan, proposal },
      confidence: 0.94,
    };
  },
  gate(): GateDecision {
    return { action: "approve", reason: "pdlc_launch_proposal_ready", outputClass: "product_launch" };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    const rec = JSON.parse(review.recommendation) as PdlcRec;
    await recordPdlcLaunch({
      workflowRun: review.workflow_run,
      product: rec.product,
      version: rec.version,
      strategy: rec.strategy,
      proposal: rec.proposal,
      approverAdminId: actor.adminId,
    });
    await logAudit({
      action: "pdlc.launch.approved",
      resource: review.workflow_run,
      details: { product: rec.product, version: rec.version, actorAdminId: actor.adminId },
    });
  },
};

// --- Support fix → product KG -------------------------------------------------

interface SupportFixCtx {
  product: string;
  issue: string;
  fixSummary: string;
}

export const productSupportFixSkill = defineSkill({
  name: "product-support-fix",
  version: "1.0.0",
  tools: {
    draft_fix: {
      scope: "product:draft",
      handler: async (a) => {
        const { issue, fixSummary } = (a ?? {}) as { issue?: string; fixSummary?: string };
        return { fix: fixSummary ?? `Fix drafted for: ${issue ?? "support issue"}` };
      },
    },
  },
});

export const productSupportFixWorkflow: WorkflowDef<SupportFixCtx, { fix: string }> = {
  skill: "product-support-fix",
  version: "1.0.0",
  supervision: "human_required",
  scopes: ["product:draft"],
  skillDef: productSupportFixSkill,
  async gather(input) {
    const i = (input ?? {}) as { product?: string; issue?: string; fixSummary?: string };
    if (!i.issue?.trim()) throw new Error("issue required");
    return {
      ctx: {
        product: i.product ?? "Goeman",
        issue: i.issue.trim(),
        fixSummary: i.fixSummary ?? "",
      },
    };
  },
  async invoke(ctx, client) {
    const { fix } = await client.call<{ fix: string }>("draft_fix", ctx);
    return { rec: { fix, product: ctx.product, issue: ctx.issue }, confidence: 0.82 };
  },
  gate(): GateDecision {
    return { action: "escalate", reason: "customer_facing_fix_requires_human", requiresRole: ["support", "compliance", "admin"] };
  },
  async executeApproved(review: AgentReviewRow, actor: AdminActor) {
    const rec = JSON.parse(review.recommendation) as { fix: string; product: string; issue: string };
    await recordSupportFix({
      workflowRun: review.workflow_run,
      product: rec.product,
      issue: rec.issue,
      fix: rec.fix,
      approverAdminId: actor.adminId,
    });
    await logAudit({
      action: "product.support_fix.approved",
      resource: review.workflow_run,
      details: { actorAdminId: actor.adminId, fix: rec.fix.slice(0, 120) },
    });
  },
};

registerWorkflow(productStrategyWorkflow as WorkflowDef);
registerWorkflow(productEngineerWorkflow as WorkflowDef);
registerWorkflow(productCyberWorkflow as WorkflowDef);
registerWorkflow(productQaWorkflow as WorkflowDef);
registerWorkflow(productDesignWorkflow as WorkflowDef);
registerWorkflow(productAgenticBuilderWorkflow as WorkflowDef);
registerWorkflow(pdlcOrchestratorWorkflow as WorkflowDef);
registerWorkflow(productSupportFixWorkflow as WorkflowDef);
