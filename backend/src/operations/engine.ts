/**
 * Phase 15.4 — the workflow-engine seam.
 *
 * The operations runner's contract (gather/gate/execute are pure; invoke is the only
 * LLM step) is substrate-agnostic, so the execution substrate is swappable behind this
 * interface without touching any workflow definition or caller:
 *
 *   - InProcessEngine — the default; runs the runner directly in this process.
 *   - TemporalEngine  — durable execution on a Temporal server (optional; see
 *                       operations/temporal/). Money/state execution still lands in
 *                       ledgerService/identityService keyed on idempotency keys —
 *                       Temporal orchestrates, it never becomes a second ledger.
 *
 * Selection is config-driven (selectOperationsEngine, called at boot); tests inject an
 * engine with setEngine(). This mirrors reconciliationService's injectable provider.
 */

import type { WorkflowDef, AdminActor, RunResult } from "./operationsWorkflow";

export interface WorkflowEngine {
  name: string;
  execute<Ctx, Rec>(def: WorkflowDef<Ctx, Rec>, input: unknown): Promise<RunResult>;
  resolve(
    reviewId: string,
    actor: AdminActor,
    humanDecision: "approve" | "reject",
    reason?: string
  ): Promise<RunResult>;
}

let defaultEngine: WorkflowEngine | null = null;
let activeEngine: WorkflowEngine | null = null;

/** Set the fallback engine (the in-process runner registers itself as this at load). */
export function setDefaultEngine(engine: WorkflowEngine): void {
  defaultEngine = engine;
}

/** Override the active engine (boot selection / tests). Pass null to revert to default. */
export function setEngine(engine: WorkflowEngine | null): void {
  activeEngine = engine;
}

export function getEngine(): WorkflowEngine {
  const engine = activeEngine ?? defaultEngine;
  if (!engine) throw new Error("No workflow engine registered; import operationsWorkflow first");
  return engine;
}
