/**
 * Phase 15.0 — the internal agent operations runner.
 *
 * THE ONE INVARIANT: agents decide; deterministic code executes; humans gate anything
 * material. An agent (the `invoke` step) only emits a structured recommendation; a
 * deterministic, RBAC-checked, audited gate is the only thing that acts. This
 * generalizes the Phase 5A onboarding pattern (riskOrchestratorService.finalizeDecision
 * is "the ONLY place a tier grant is authorized — the model is advisory").
 *
 * Every workflow has the same shape:
 *   gather (deterministic) → invoke (scoped skill toolset; the ONLY LLM step)
 *     → gate (deterministic + RBAC) → execute | queue-for-human → audit (append-only).
 *
 * Containment: a master kill-switch (config.OPERATIONS_ENABLED), a confidence floor
 * that auto-escalates (config.OPERATIONS_REVIEW_FLOOR, mirrors ONBOARDING_REVIEW_FLOOR),
 * and a circuit breaker — if `invoke` throws (LLM/MCP down), the run degrades to a
 * human escalation rather than failing open.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "../services/auditService";
import { agentRunTotal, agentEscalationTotal } from "../observability/metrics";
import type { AdminRole } from "../middleware/rbac";
import { createScopedClient, type Skill, type ScopedSkillClient, type ToolCallRecord } from "./skillRegistry";
import { type WorkflowEngine, getEngine, setDefaultEngine } from "./engine";

export type SupervisionTier = "auto_approve" | "auto_approve_audit" | "human_required" | "human_led";

export interface AdminActor {
  adminId: string;
  role: AdminRole;
}

export interface GateDecision {
  action: "approve" | "reject" | "escalate";
  reason: string;
  /** Roles allowed to resolve this at the human gate (when escalated / executing). */
  requiresRole?: AdminRole[];
}

export interface AgentReviewRow {
  id: string;
  run_id: string;
  workflow_run: string;
  skill: string;
  subject_user_id: string | null;
  status: "pending" | "approved" | "rejected";
  requires_role: string;
  recommendation: string;
  reason: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

/**
 * A back-office workflow. Ctx/Rec/Out are opaque to the runner. `gather`, `gate`, and
 * the execute steps are deterministic; `invoke` is the only step that may touch an LLM.
 */
export interface WorkflowDef<Ctx = unknown, Rec = unknown> {
  skill: string;
  version: string;
  supervision: SupervisionTier;
  /** Scopes granted to this run's scoped skill client. */
  scopes: string[];
  skillDef: Skill;
  gather: (input: unknown) => Promise<{ ctx: Ctx; subjectUserId?: string }>;
  invoke: (ctx: Ctx, client: ScopedSkillClient) => Promise<{ rec: Rec; confidence: number }>;
  gate: (ctx: Ctx, rec: Rec | null, confidence: number) => GateDecision;
  /** Auto path (auto_approve*): run when the gate approves without a human. */
  execute?: (ctx: Ctx, rec: Rec) => Promise<unknown>;
  /** Human path: run when a human approves a queued review. */
  executeApproved?: (review: AgentReviewRow, actor: AdminActor) => Promise<unknown>;
}

const registry = new Map<string, WorkflowDef>();

/** Register a workflow so resolveReview can find it by skill name. */
export function registerWorkflow(def: WorkflowDef): void {
  registry.set(def.skill, def);
}

export function getWorkflow(skill: string): WorkflowDef | undefined {
  return registry.get(skill);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function defaultRoles(d: GateDecision): AdminRole[] {
  return d.requiresRole && d.requiresRole.length > 0 ? d.requiresRole : ["compliance", "admin"];
}

export interface RunResult {
  runId: string;
  workflowRun: string;
  outcome: "executed" | "queued" | "rejected";
  reviewId?: string;
}

async function insertAgentRun(row: {
  skill: string;
  version: string;
  workflowRun: string;
  supervision: SupervisionTier;
  toolCalls: ToolCallRecord[];
  recommendation: unknown;
  gateDecision: GateDecision;
  actorAdminId: string | null;
  outcome: string;
  confidence: number | null;
}): Promise<string> {
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO agent_runs
       (id, skill, skill_version, workflow_run, supervision, tool_calls, recommendation,
        gate_decision, actor_admin_id, outcome, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      row.skill,
      row.version,
      row.workflowRun,
      row.supervision,
      JSON.stringify(row.toolCalls),
      JSON.stringify(row.recommendation ?? {}),
      JSON.stringify(row.gateDecision),
      row.actorAdminId,
      row.outcome,
      row.confidence,
      new Date().toISOString(),
    ]
  );
  return id;
}

/**
 * The in-process implementation of a workflow run (the default engine). Public callers
 * use runOperation(), which delegates to the active engine; this is exported so the
 * Temporal adapter can fall back to it and register it as the default engine.
 */
export async function executeInProcess<Ctx, Rec>(
  def: WorkflowDef<Ctx, Rec>,
  input: unknown
): Promise<RunResult> {
  if (!config.OPERATIONS_ENABLED) {
    throw new AppError(ErrorCode.AGENT_DISABLED, "Internal agent operations are disabled");
  }

  const workflowRun = uuidv4();
  const { ctx, subjectUserId } = await def.gather(input);
  const client = createScopedClient(def.skillDef, def.scopes);

  // Circuit breaker: a failed invoke (LLM/MCP outage) degrades to human escalation.
  let rec: Rec | null = null;
  let confidence = 0;
  let forcedEscalation: string | null = null;
  try {
    const out = await def.invoke(ctx, client);
    rec = out.rec;
    confidence = clamp01(out.confidence);
  } catch {
    forcedEscalation = "invoke_failed";
  }

  // Confidence floor: a low-confidence auto-decision is escalated regardless of tier.
  if (!forcedEscalation && confidence < config.OPERATIONS_REVIEW_FLOOR) {
    forcedEscalation = "low_confidence";
  }

  let decision = def.gate(ctx, rec, confidence);
  // Supervision: human_* workflows never auto-execute; an approve becomes an escalation.
  const humanSupervised = def.supervision === "human_required" || def.supervision === "human_led";
  if (forcedEscalation) {
    decision = { action: "escalate", reason: forcedEscalation, requiresRole: decision.requiresRole };
  } else if (humanSupervised && decision.action === "approve") {
    decision = { action: "escalate", reason: "human_required", requiresRole: decision.requiresRole };
  }

  const toolCalls = client.getCalls();

  if (decision.action === "escalate") {
    const runId = await insertAgentRun({
      skill: def.skill, version: def.version, workflowRun, supervision: def.supervision,
      toolCalls, recommendation: rec, gateDecision: decision, actorAdminId: null,
      outcome: "queued", confidence,
    });
    const reviewId = uuidv4();
    await getDb().execute(
      `INSERT INTO agent_reviews
         (id, run_id, workflow_run, skill, subject_user_id, status, requires_role, recommendation, reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        reviewId, runId, workflowRun, def.skill, subjectUserId ?? null,
        defaultRoles(decision).join(","), JSON.stringify(rec ?? {}), decision.reason, new Date().toISOString(),
      ]
    );
    agentRunTotal.inc({ skill: def.skill, outcome: "queued" });
    agentEscalationTotal.inc({ skill: def.skill, reason: decision.reason });
    await logAudit({
      userId: subjectUserId ?? null, action: "agent.run.queued", resource: workflowRun,
      details: { skill: def.skill, reason: decision.reason, confidence },
    });
    return { runId, workflowRun, outcome: "queued", reviewId };
  }

  if (decision.action === "reject") {
    const runId = await insertAgentRun({
      skill: def.skill, version: def.version, workflowRun, supervision: def.supervision,
      toolCalls, recommendation: rec, gateDecision: decision, actorAdminId: null,
      outcome: "rejected", confidence,
    });
    agentRunTotal.inc({ skill: def.skill, outcome: "rejected" });
    await logAudit({
      userId: subjectUserId ?? null, action: "agent.run.rejected", resource: workflowRun,
      status: "blocked", details: { skill: def.skill, reason: decision.reason },
    });
    return { runId, workflowRun, outcome: "rejected" };
  }

  // approve (auto path only — human_* was converted above).
  if (def.execute && rec !== null) {
    await def.execute(ctx, rec);
  }
  const runId = await insertAgentRun({
    skill: def.skill, version: def.version, workflowRun, supervision: def.supervision,
    toolCalls, recommendation: rec, gateDecision: decision, actorAdminId: null,
    outcome: "executed", confidence,
  });
  agentRunTotal.inc({ skill: def.skill, outcome: "executed" });
  await logAudit({
    userId: subjectUserId ?? null, action: "agent.run.executed", resource: workflowRun,
    details: { skill: def.skill, reason: decision.reason, confidence },
  });
  return { runId, workflowRun, outcome: "executed" };
}

/** List queued (or otherwise filtered) human-review items. */
export async function listReviews(status: AgentReviewRow["status"] = "pending"): Promise<AgentReviewRow[]> {
  return getDb().query<AgentReviewRow>(
    "SELECT * FROM agent_reviews WHERE status = ? ORDER BY created_at ASC",
    [status]
  );
}

/** The append-only run trail for one workflow run (correlated steps/decisions). */
export async function getRunTrail(workflowRun: string): Promise<unknown[]> {
  return getDb().query(
    "SELECT * FROM agent_runs WHERE workflow_run = ? ORDER BY created_at ASC",
    [workflowRun]
  );
}

/**
 * A human resolves a queued review. RBAC: the actor's role must be in the review's
 * requires_role allow-list (captured at escalation time). On approve, the workflow's
 * deterministic executeApproved runs; on reject, nothing executes. Either way a new
 * append-only agent_run records the human's decision.
 */
/** The in-process implementation of a human review resolution (the default engine). */
export async function resolveInProcess(
  reviewId: string,
  actor: AdminActor,
  humanDecision: "approve" | "reject",
  reason?: string
): Promise<RunResult> {
  if (!config.OPERATIONS_ENABLED) {
    throw new AppError(ErrorCode.AGENT_DISABLED, "Internal agent operations are disabled");
  }
  const db = getDb();
  const review = await db.queryOne<AgentReviewRow>("SELECT * FROM agent_reviews WHERE id = ?", [reviewId]);
  if (!review) throw new AppError(ErrorCode.NOT_FOUND, "Review not found");
  if (review.status !== "pending") throw new AppError(ErrorCode.CONFLICT, "Review already resolved");

  const allowed = review.requires_role.split(",").map((r) => r.trim());
  if (!allowed.includes(actor.role)) {
    throw new AppError(ErrorCode.FORBIDDEN, `Requires role: ${allowed.join(" or ")}`);
  }

  const def = getWorkflow(review.skill);
  if (!def) throw new AppError(ErrorCode.INTERNAL, `No registered workflow for skill ${review.skill}`);

  const now = new Date().toISOString();
  const gateDecision: GateDecision = {
    action: humanDecision === "approve" ? "approve" : "reject",
    reason: reason ?? `human ${humanDecision}`,
    requiresRole: allowed as AdminRole[],
  };

  if (humanDecision === "approve") {
    if (def.executeApproved) await def.executeApproved(review, actor);
  }

  const runId = await insertAgentRun({
    skill: review.skill, version: def.version, workflowRun: review.workflow_run, supervision: def.supervision,
    toolCalls: [], recommendation: JSON.parse(review.recommendation), gateDecision,
    actorAdminId: actor.adminId, outcome: humanDecision === "approve" ? "executed" : "rejected",
    confidence: null,
  });

  await db.execute(
    `UPDATE agent_reviews SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?`,
    [humanDecision === "approve" ? "approved" : "rejected", actor.adminId, reason ?? null, now, reviewId]
  );

  agentRunTotal.inc({ skill: review.skill, outcome: humanDecision === "approve" ? "executed" : "rejected" });
  await logAudit({
    userId: review.subject_user_id, action: `agent.review.${humanDecision}`, resource: review.workflow_run,
    status: humanDecision === "approve" ? "success" : "blocked",
    details: { skill: review.skill, actorAdminId: actor.adminId, reviewId },
  });

  return {
    runId,
    workflowRun: review.workflow_run,
    outcome: humanDecision === "approve" ? "executed" : "rejected",
    reviewId,
  };
}

// ---------------------------------------------------------------------------
// Engine seam — public entry points delegate to the active engine. The in-process
// engine wraps the *InProcess functions above and is registered as the default.
// ---------------------------------------------------------------------------

export const inProcessEngine: WorkflowEngine = {
  name: "in_process",
  execute: (def, input) => executeInProcess(def, input),
  resolve: (reviewId, actor, humanDecision, reason) => resolveInProcess(reviewId, actor, humanDecision, reason),
};
setDefaultEngine(inProcessEngine);

/**
 * Run a workflow end to end through the active engine (in-process by default; Temporal
 * when selected). An auto_approve* workflow may execute; a human_* workflow (or any
 * escalation) is queued for a human gate.
 */
export async function runOperation<Ctx, Rec>(def: WorkflowDef<Ctx, Rec>, input: unknown): Promise<RunResult> {
  return getEngine().execute(def, input);
}

/** A human resolves a queued review through the active engine. */
export async function resolveReview(
  reviewId: string,
  actor: AdminActor,
  humanDecision: "approve" | "reject",
  reason?: string
): Promise<RunResult> {
  return getEngine().resolve(reviewId, actor, humanDecision, reason);
}
