/**
 * Phase 15.4 — Temporal activities for the operations runner.
 *
 * Activities are where side effects live (DB, services) — the Temporal workflow itself
 * stays deterministic and only orchestrates these. To keep ONE source of truth for the
 * gather→invoke→gate→execute|queue logic, each activity delegates to the existing
 * in-process engine functions; Temporal adds durable, retryable execution around them.
 * (Finer-grained activities — separate gather/invoke/gate/execute — are the documented
 * next step; the contract already supports it since those steps are pure.)
 *
 * These are plain async functions: unit-testable without a Temporal server, and what
 * the worker registers.
 */

import { executeInProcess, resolveInProcess, getWorkflow, type AdminActor, type RunResult } from "../operationsWorkflow";
import { AppError, ErrorCode } from "../../errors";

export async function runOperationActivity(skill: string, input: unknown): Promise<RunResult> {
  const def = getWorkflow(skill);
  if (!def) throw new AppError(ErrorCode.INTERNAL, `No registered workflow for skill ${skill}`);
  return executeInProcess(def, input);
}

export async function resolveReviewActivity(
  reviewId: string,
  actor: AdminActor,
  humanDecision: "approve" | "reject",
  reason?: string
): Promise<RunResult> {
  return resolveInProcess(reviewId, actor, humanDecision, reason);
}
