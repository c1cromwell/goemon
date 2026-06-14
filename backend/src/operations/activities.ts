/**
 * Phase 15.4 — operation "activities": the side-effecting unit any orchestrator
 * (Temporal, Conductor) invokes. To keep ONE source of truth for the
 * gather→invoke→gate→execute|queue logic, each activity delegates to the in-process
 * engine functions; the orchestrator adds durable, retryable execution around them.
 *
 * Plain async functions — unit-testable without any orchestration server.
 */

import { executeInProcess, resolveInProcess, getWorkflow, type AdminActor, type RunResult } from "./operationsWorkflow";
import { AppError, ErrorCode } from "../errors";

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
