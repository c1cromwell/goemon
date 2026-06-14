/**
 * Phase 15.4 — Temporal activities. The implementations are shared with Conductor and
 * live in operations/activities.ts; this module re-exports them as the set the Temporal
 * worker registers (and that workflow.ts proxies).
 */

export { runOperationActivity, resolveReviewActivity } from "../activities";
