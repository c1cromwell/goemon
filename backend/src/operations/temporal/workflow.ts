/**
 * Phase 15.4 — Temporal workflow definitions (the durable orchestration shell).
 *
 * NOTE: this file runs in Temporal's deterministic workflow sandbox and is bundled by
 * the Temporal tooling — NOT compiled by the API's tsc (it is in tsconfig "exclude").
 * It may import only from "@temporalio/workflow" and call activities via proxies; it
 * must never touch the DB, the clock, or randomness directly (those live in activities).
 *
 * The workflows are thin: they own retries/timeouts/durability and delegate the actual
 * logic to activities (which delegate to the single in-process engine implementation).
 */

import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { runOperationActivity, resolveReviewActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

export async function runOperationWorkflow(skill: string, input: unknown) {
  return runOperationActivity(skill, input);
}

export async function resolveReviewWorkflow(
  reviewId: string,
  actor: { adminId: string; role: "support" | "compliance" | "admin" },
  humanDecision: "approve" | "reject",
  reason?: string
) {
  return resolveReviewActivity(reviewId, actor, humanDecision, reason);
}
