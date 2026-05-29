/**
 * Phase 5A — Specialized onboarding sub-agents.
 *
 * These are the ephemeral agents the risk orchestrator spawns dynamically when a
 * session's confidence is below threshold. Each one records an onboarding_agent_runs
 * row (created "running", finalized "passed"/"failed") plus an audit event, performs
 * its (simulated) verification, and returns a PII-free result. The orchestrator owns
 * the session-level confidence math and the final decision; these agents only verify.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { logAudit } from "./auditService";
import { screenSanctions } from "./identityService";
import type { OnboardingStep } from "../utils/orchestratorModel";

// Confidence deltas applied by a sub-agent outcome (clamped to [0,1] by the caller).
const DOC_PASS_BOOST = 0.35;
const DOC_FAIL_PENALTY = 0.2;
const POSSESSION_PASS_BOOST = 0.15;
const POSSESSION_FAIL_PENALTY = 0.15;

export interface AgentResult {
  step: OnboardingStep;
  passed: boolean;
  confidenceAfter: number;
  sanctionsBlocked: boolean;
  detail: Record<string, unknown>;
}

export interface DocumentInput {
  documentNumber: string;
  documentType?: string;
  fullName?: string;
  dob?: string;
  country?: string;
}

export interface PossessionInput {
  /** Simulated possession proof (e.g. an OTP). "000000" simulates a failed challenge. */
  code?: string;
  factor?: "email_otp" | "sms_otp" | "device";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

async function startRun(
  sessionId: string,
  agentType: OnboardingStep,
  confidenceBefore: number,
  input: Record<string, unknown>
): Promise<string> {
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO onboarding_agent_runs (id, session_id, agent_type, status, input_json, confidence_before, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    [id, sessionId, agentType, JSON.stringify(input), confidenceBefore, new Date().toISOString()]
  );
  return id;
}

async function finishRun(
  runId: string,
  passed: boolean,
  confidenceAfter: number,
  output: Record<string, unknown>
): Promise<void> {
  await getDb().execute(
    `UPDATE onboarding_agent_runs
     SET status = ?, output_json = ?, confidence_after = ?, completed_at = ?
     WHERE id = ?`,
    [passed ? "passed" : "failed", JSON.stringify(output), confidenceAfter, new Date().toISOString(), runId]
  );
}

/** Simulated document-number outcomes (same convention as the IDV provider). */
function evaluateDocument(documentNumber: string): { passed: boolean; reason: string; confidence: number } {
  switch (documentNumber.trim()) {
    case "1":
      return { passed: false, reason: "expired", confidence: 0.2 };
    case "2":
      return { passed: false, reason: "tampered", confidence: 0.1 };
    case "3":
      return { passed: false, reason: "low_quality", confidence: 0.3 };
    default:
      return { passed: true, reason: "verified", confidence: 0.95 };
  }
}

/**
 * Document-validation sub-agent. Reuses the document_verifications table for its
 * artifact record and runs a sanctions screen on the document name. Note: the raw
 * name/dob are written only to the document_verifications row (the existing PII
 * store); the agent_run row + audit + returned detail stay PII-free.
 */
export async function runDocumentValidationAgent(
  sessionId: string,
  userId: string,
  profileId: string,
  confidenceBefore: number,
  input: DocumentInput
): Promise<AgentResult> {
  const runId = await startRun(sessionId, "document_validation", confidenceBefore, {
    documentType: input.documentType ?? "passport",
    country: input.country ?? "US",
  });

  const eval_ = evaluateDocument(input.documentNumber);
  const sanctions = input.fullName ? screenSanctions(input.fullName) : { clear: true };
  const sanctionsBlocked = !sanctions.clear;
  const passed = eval_.passed && !sanctionsBlocked;

  const confidenceAfter = clamp01(
    passed ? confidenceBefore + DOC_PASS_BOOST : confidenceBefore - DOC_FAIL_PENALTY
  );

  await getDb().execute(
    `INSERT INTO document_verifications (id, user_id, profile_id, document_type, issuing_country,
       document_number, full_name, date_of_birth, provider, provider_ref, status, confidence_score, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simulated', ?, ?, ?, ?)`,
    [
      uuidv4(),
      userId,
      profileId,
      input.documentType ?? "passport",
      input.country ?? "US",
      input.documentNumber,
      input.fullName ?? null,
      input.dob ?? null,
      runId,
      passed ? "passed" : "failed",
      eval_.confidence,
      runId,
    ]
  );

  const detail = { reason: eval_.reason, sanctionsBlocked };
  await finishRun(runId, passed, confidenceAfter, detail);
  await logAudit({
    userId,
    action: "onboarding.agent.document",
    resource: sessionId,
    status: passed ? "success" : "blocked",
    details: { runId, ...detail },
  });

  return { step: "document_validation", passed, confidenceAfter, sanctionsBlocked, detail };
}

/**
 * Possession-check sub-agent. Simulated control-of-factor check (email/SMS OTP or
 * device possession). A code of "000000" simulates a failed challenge.
 */
export async function runPossessionCheckAgent(
  sessionId: string,
  userId: string,
  confidenceBefore: number,
  input: PossessionInput
): Promise<AgentResult> {
  const factor = input.factor ?? "email_otp";
  const runId = await startRun(sessionId, "possession_check", confidenceBefore, { factor });

  const passed = (input.code ?? "123456") !== "000000";
  const confidenceAfter = clamp01(
    passed ? confidenceBefore + POSSESSION_PASS_BOOST : confidenceBefore - POSSESSION_FAIL_PENALTY
  );

  const detail = { factor, outcome: passed ? "verified" : "failed" };
  await finishRun(runId, passed, confidenceAfter, detail);
  await logAudit({
    userId,
    action: "onboarding.agent.possession",
    resource: sessionId,
    status: passed ? "success" : "blocked",
    details: { runId, ...detail },
  });

  return { step: "possession_check", passed, confidenceAfter, sanctionsBlocked: false, detail };
}
