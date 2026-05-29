/**
 * Phase 5A — Risk orchestrator service (the brain of agentic account opening).
 *
 * Flow:
 *   startOnboarding → assess signals → ask the orchestrator model for a structured
 *   assessment (confidence + required steps) → applyDecision. When confidence is
 *   below threshold the model's required_steps are "spawned": the session enters
 *   awaiting_verification and the specialized sub-agents (document_validation,
 *   possession_check) run as their artifacts arrive (submitDocument/submitPossession),
 *   each re-aggregating confidence and re-deciding.
 *
 * INVARIANT: finalizeDecision is deterministic policy and is the ONLY place a tier
 * grant is authorized. The model is advisory — even a high model confidence cannot
 * override the guardrails here (a very weak single signal, a failed verification, or
 * a sanctions hit blocks straight-through approval).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { ensureProfile, completeKycDecision } from "./identityService";
import { assessSignals, type RawSignals } from "./signalService";
import {
  runDocumentValidationAgent,
  runPossessionCheckAgent,
  type DocumentInput,
  type PossessionInput,
} from "./onboardingAgents";
import { assessRisk, type SignalSummary, type OnboardingStep, type RiskTier } from "../utils/orchestratorModel";

export type Decision = "auto_approve" | "step_up" | "manual_review" | "reject";
export type SessionStatus =
  | "collecting"
  | "assessing"
  | "awaiting_verification"
  | "review_required"
  | "approved"
  | "rejected";

const TERMINAL: SessionStatus[] = ["approved", "rejected"];
const GRANT_GUARDRAIL_FLOOR = 0.3; // any single sub-score below this blocks auto-approval

interface SessionRow {
  id: string;
  user_id: string;
  status: SessionStatus;
  email_score: number | null;
  ip_score: number | null;
  device_score: number | null;
  behavior_score: number | null;
  pii_confidence: number | null;
  device_fingerprint: string | null;
  signals_json: string;
  required_steps: string;
  decision: string | null;
  decided_tier: number | null;
  decided_risk_tier: string | null;
  orchestrator: string;
  rationale: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AgentRunRow {
  id: string;
  agent_type: OnboardingStep | "risk_orchestrator";
  status: "running" | "passed" | "failed";
  input_json: string;
  output_json: string;
  confidence_before: number | null;
  confidence_after: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface SessionView {
  id: string;
  status: SessionStatus;
  decision: Decision | null;
  pii_confidence: number | null;
  required_steps: OnboardingStep[];
  scores: { email: number | null; ip: number | null; device: number | null; behavior: number | null };
  signals: Record<string, unknown>;
  decided_tier: number | null;
  decided_risk_tier: string | null;
  orchestrator: string;
  rationale: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  agent_runs: Array<{
    agent_type: string;
    status: string;
    confidence_before: number | null;
    confidence_after: number | null;
    output: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Pure decision policy (testable in isolation)
// ---------------------------------------------------------------------------

export interface DecisionContext {
  confidence: number;
  summary: SignalSummary;
  pendingSteps: OnboardingStep[];
  failedSteps: OnboardingStep[];
  sanctionsBlocked: boolean;
}

export interface DecisionResult {
  decision: Decision;
  status: SessionStatus;
  grantTier: number | null;
  riskTier: RiskTier;
}

function tierFor(confidence: number): RiskTier {
  if (confidence >= 0.8) return "low";
  if (confidence >= 0.6) return "medium";
  return "high";
}

/**
 * Deterministic decision policy. Order matters: hard blocks (sanctions) and failed
 * verifications take precedence over any confidence score, and a single very weak
 * signal blocks straight-through approval regardless of the (advisory) model output.
 */
export function finalizeDecision(ctx: DecisionContext): DecisionResult {
  const threshold = config.ONBOARDING_CONFIDENCE_THRESHOLD;
  const floor = config.ONBOARDING_REVIEW_FLOOR;
  const riskTier = tierFor(ctx.confidence);

  if (ctx.sanctionsBlocked) {
    return { decision: "reject", status: "rejected", grantTier: null, riskTier: "high" };
  }
  if (ctx.failedSteps.length > 0) {
    // A failed verification is escalated to a human, never silently auto-decided.
    return { decision: "manual_review", status: "review_required", grantTier: null, riskTier };
  }
  if (ctx.pendingSteps.length > 0) {
    return { decision: "step_up", status: "awaiting_verification", grantTier: null, riskTier };
  }
  const lowestSub = Math.min(
    ctx.summary.email_score,
    ctx.summary.ip_score,
    ctx.summary.device_score,
    ctx.summary.behavior_score
  );
  const guardrailTripped = lowestSub < GRANT_GUARDRAIL_FLOOR;
  if (ctx.confidence >= threshold && !guardrailTripped) {
    return { decision: "auto_approve", status: "approved", grantTier: 2, riskTier };
  }
  if (ctx.confidence >= floor) {
    return { decision: "manual_review", status: "review_required", grantTier: null, riskTier };
  }
  return { decision: "reject", status: "rejected", grantTier: null, riskTier };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function getActiveSession(userId: string): Promise<SessionRow | null> {
  return getDb().queryOne<SessionRow>(
    "SELECT * FROM onboarding_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
}

async function getRuns(sessionId: string): Promise<AgentRunRow[]> {
  return getDb().query<AgentRunRow>(
    "SELECT * FROM onboarding_agent_runs WHERE session_id = ? ORDER BY started_at ASC",
    [sessionId]
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseSteps(json: string): OnboardingStep[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as OnboardingStep[]) : [];
  } catch {
    return [];
  }
}

/** Derive step state from the session's sub-agent runs. */
async function deriveStepState(
  session: SessionRow
): Promise<{ pendingSteps: OnboardingStep[]; failedSteps: OnboardingStep[]; sanctionsBlocked: boolean }> {
  const required = parseSteps(session.required_steps);
  const runs = await getRuns(session.id);
  const resolved = new Map<OnboardingStep, "passed" | "failed">();
  let sanctionsBlocked = false;
  for (const r of runs) {
    if (r.agent_type === "risk_orchestrator") continue;
    if (r.status === "passed" || r.status === "failed") {
      resolved.set(r.agent_type as OnboardingStep, r.status);
    }
    if ((safeParse(r.output_json).sanctionsBlocked as boolean) === true) sanctionsBlocked = true;
  }
  const pendingSteps = required.filter((s) => !resolved.has(s));
  const failedSteps = required.filter((s) => resolved.get(s) === "failed");
  return { pendingSteps, failedSteps, sanctionsBlocked };
}

async function toView(session: SessionRow): Promise<SessionView> {
  const runs = await getRuns(session.id);
  return {
    id: session.id,
    status: session.status,
    decision: (session.decision as Decision | null) ?? null,
    pii_confidence: session.pii_confidence,
    required_steps: parseSteps(session.required_steps),
    scores: {
      email: session.email_score,
      ip: session.ip_score,
      device: session.device_score,
      behavior: session.behavior_score,
    },
    signals: safeParse(session.signals_json),
    decided_tier: session.decided_tier,
    decided_risk_tier: session.decided_risk_tier,
    orchestrator: session.orchestrator,
    rationale: session.rationale,
    created_at: session.created_at,
    updated_at: session.updated_at,
    completed_at: session.completed_at,
    agent_runs: runs.map((r) => ({
      agent_type: r.agent_type,
      status: r.status,
      confidence_before: r.confidence_before,
      confidence_after: r.confidence_after,
      output: safeParse(r.output_json),
      started_at: r.started_at,
      completed_at: r.completed_at,
    })),
  };
}

/** Apply the decision policy to the current session state and persist the outcome. */
async function applyDecision(session: SessionRow): Promise<SessionView> {
  const db = getDb();
  const summary = safeParse(session.signals_json) as unknown as SignalSummary;
  const { pendingSteps, failedSteps, sanctionsBlocked } = await deriveStepState(session);
  const confidence = session.pii_confidence ?? 0;

  const result = finalizeDecision({ confidence, summary, pendingSteps, failedSteps, sanctionsBlocked });
  const now = new Date().toISOString();
  // review_required is NOT terminal — an admin still resolves it, which sets completed_at then.
  const completedAt = TERMINAL.includes(result.status) ? now : null;

  if (result.status === "approved" && result.grantTier) {
    await completeKycDecision(session.user_id, {
      tier: result.grantTier,
      riskTier: result.riskTier,
      sanctionsClear: true,
      riskScore: Number((1 - confidence).toFixed(4)),
      sessionId: session.id,
      provider: "agentic",
    });
  }

  await db.execute(
    `UPDATE onboarding_sessions
     SET status = ?, decision = ?, decided_tier = ?, decided_risk_tier = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`,
    [result.status, result.decision, result.grantTier, result.riskTier, now, completedAt, session.id]
  );

  await logAudit({
    userId: session.user_id,
    action: "onboarding.decision",
    resource: session.id,
    status: result.decision === "reject" ? "blocked" : "success",
    details: {
      decision: result.decision,
      status: result.status,
      confidence,
      orchestrator: session.orchestrator,
      pendingSteps,
      failedSteps,
    },
  });

  return toView({ ...session, status: result.status, decision: result.decision, decided_tier: result.grantTier, decided_risk_tier: result.riskTier, completed_at: completedAt });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startOnboarding(userId: string, raw: RawSignals): Promise<SessionView> {
  const db = getDb();
  const profile = await ensureProfile(userId);
  if (profile.tier >= 2) throw new AppError(ErrorCode.CONFLICT, "Identity already verified (Tier 2)");

  const existing = await getActiveSession(userId);
  if (existing && !TERMINAL.includes(existing.status)) {
    throw new AppError(ErrorCode.CONFLICT, "Onboarding already in progress; submit pending steps or check status");
  }

  const { summary, deviceFingerprint } = await assessSignals(userId, raw);
  const { assessment, orchestrator } = await assessRisk(summary);

  const sessionId = uuidv4();
  const now = new Date().toISOString();
  const requiredStepsJson = JSON.stringify(assessment.required_steps);

  await db.execute(
    `INSERT INTO onboarding_sessions
       (id, user_id, status, email_score, ip_score, device_score, behavior_score, pii_confidence,
        device_fingerprint, signals_json, required_steps, orchestrator, rationale, created_at, updated_at)
     VALUES (?, ?, 'assessing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      summary.email_score,
      summary.ip_score,
      summary.device_score,
      summary.behavior_score,
      assessment.pii_confidence,
      deviceFingerprint,
      JSON.stringify(summary),
      requiredStepsJson,
      orchestrator,
      assessment.rationale,
      now,
      now,
    ]
  );

  // Record the orchestrator agent's own run for the audit/visibility trail.
  await db.execute(
    `INSERT INTO onboarding_agent_runs
       (id, session_id, agent_type, status, input_json, output_json, confidence_after, started_at, completed_at)
     VALUES (?, ?, 'risk_orchestrator', 'passed', '{}', ?, ?, ?, ?)`,
    [
      uuidv4(),
      sessionId,
      JSON.stringify({
        required_steps: assessment.required_steps,
        recommended_risk_tier: assessment.recommended_risk_tier,
      }),
      assessment.pii_confidence,
      now,
      now,
    ]
  );

  await logAudit({
    userId,
    action: "onboarding.session.start",
    resource: sessionId,
    details: { orchestrator, confidence: assessment.pii_confidence, required_steps: assessment.required_steps },
  });

  const session = (await getDb().queryOne<SessionRow>("SELECT * FROM onboarding_sessions WHERE id = ?", [sessionId]))!;
  return applyDecision(session);
}

async function requireAwaitingSession(userId: string, step: OnboardingStep): Promise<SessionRow> {
  const session = await getActiveSession(userId);
  if (!session || session.status !== "awaiting_verification") {
    throw new AppError(ErrorCode.CONFLICT, "No onboarding session awaiting verification");
  }
  const required = parseSteps(session.required_steps);
  if (!required.includes(step)) {
    throw new AppError(ErrorCode.VALIDATION, `Step ${step} is not required for this session`);
  }
  const { pendingSteps } = await deriveStepState(session);
  if (!pendingSteps.includes(step)) {
    throw new AppError(ErrorCode.CONFLICT, `Step ${step} already completed`);
  }
  return session;
}

export async function submitDocument(userId: string, input: DocumentInput): Promise<SessionView> {
  if (!input.documentNumber) throw new AppError(ErrorCode.VALIDATION, "documentNumber required");
  const session = await requireAwaitingSession(userId, "document_validation");
  const profile = await ensureProfile(userId);

  const result = await runDocumentValidationAgent(
    session.id,
    userId,
    profile.id,
    session.pii_confidence ?? 0,
    input
  );
  await getDb().execute("UPDATE onboarding_sessions SET pii_confidence = ?, updated_at = ? WHERE id = ?", [
    result.confidenceAfter,
    new Date().toISOString(),
    session.id,
  ]);

  const fresh = (await getDb().queryOne<SessionRow>("SELECT * FROM onboarding_sessions WHERE id = ?", [session.id]))!;
  return applyDecision(fresh);
}

export async function submitPossession(userId: string, input: PossessionInput): Promise<SessionView> {
  const session = await requireAwaitingSession(userId, "possession_check");

  const result = await runPossessionCheckAgent(session.id, userId, session.pii_confidence ?? 0, input);
  await getDb().execute("UPDATE onboarding_sessions SET pii_confidence = ?, updated_at = ? WHERE id = ?", [
    result.confidenceAfter,
    new Date().toISOString(),
    session.id,
  ]);

  const fresh = (await getDb().queryOne<SessionRow>("SELECT * FROM onboarding_sessions WHERE id = ?", [session.id]))!;
  return applyDecision(fresh);
}

export async function getStatus(userId: string): Promise<SessionView | null> {
  const session = await getActiveSession(userId);
  if (!session) return null;
  return toView(session);
}

/** All session views for a user, newest first (used by the admin detail view). */
export async function listUserSessionViews(userId: string): Promise<SessionView[]> {
  const rows = await getDb().query<SessionRow>(
    "SELECT * FROM onboarding_sessions WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  return Promise.all(rows.map(toView));
}
