/**
 * Journey runner — walks the declarative DAG over a JourneyContext.
 *
 *   run a step (handler) → record the append-only trail → apply the context patch →
 *   route (CEL branches → next) → repeat until: await (pause for input), review
 *   (pause for a human), or done (terminal outcome).
 *
 * Runs are persisted at every pause, so a journey is fully resumable (start on web,
 * finish on mobile; survive a restart). A step budget guards against a misconfigured
 * cycle (journeys are DAGs, but config is data — defend it).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { compile, test as celTest } from "./cel";
import type { CelValue } from "./cel";
import { getStepHandler, toActivation } from "./stepRegistry";
import { registerDefaultStepHandlers } from "./stepRegistry";
import { registerDefaultConnectors } from "./connectors";
import { loadJourney } from "./journeyStore";
import type { JourneyContext, JourneyDef, RunStatus, RunView, StepDef, ScreenDescriptor } from "./types";

const STEP_BUDGET = 200; // max steps per advance() — cycle guard

registerDefaultStepHandlers();
registerDefaultConnectors();

function stepById(def: JourneyDef, id: string): StepDef {
  const s = def.steps.find((x) => x.id === id);
  if (!s) throw new Error(`journey ${def.id}: no step '${id}'`);
  return s;
}

/** Route from a step: an explicit override wins, else the first matching CEL branch, else `next`. */
function pickNext(step: StepDef, ctx: JourneyContext, override?: string): string | undefined {
  if (override) return override;
  const act = toActivation(ctx);
  for (const b of step.branches ?? []) {
    if (celTest(compile(b.when), act)) return b.to;
  }
  return step.next;
}

async function recordStep(runId: string, step: StepDef, control: string, detail: unknown): Promise<void> {
  await getDb().execute(
    "INSERT INTO journey_steps (id, run_id, step_id, step_type, control, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [uuidv4(), runId, step.id, step.type, control, JSON.stringify(detail ?? {}), new Date().toISOString()]
  );
}

async function persist(ctx: JourneyContext, def: JourneyDef, status: RunStatus, currentStep: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE journey_runs SET status = ?, current_step = ?, context = ?, outcome = ?, updated_at = ?
     WHERE id = ?`,
    [status, currentStep, JSON.stringify(ctx), ctx.outcome?.result ?? null, now, ctx.runId]
  );
}

interface RunRow {
  id: string; journey_id: string; version: string; subject_user_id: string | null;
  status: RunStatus; current_step: string; context: string;
}

async function loadRun(runId: string): Promise<{ row: RunRow; ctx: JourneyContext; def: JourneyDef }> {
  const row = await getDb().queryOne<RunRow>("SELECT * FROM journey_runs WHERE id = ?", [runId]);
  if (!row) throw new Error(`journey run '${runId}' not found`);
  const ctx = JSON.parse(row.context) as JourneyContext;
  const def = await loadJourney(row.journey_id);
  return { row, ctx, def };
}

/** Execute steps from currentStepId until the journey pauses or completes. */
async function advance(def: JourneyDef, ctx: JourneyContext, currentStepId: string): Promise<RunView> {
  let stepId = currentStepId;
  let lastUi: ScreenDescriptor | undefined;
  for (let n = 0; n < STEP_BUDGET; n++) {
    const step = stepById(def, stepId);
    const result = await getStepHandler(step.type).execute(ctx, step);
    await recordStep(ctx.runId, step, result.control.kind, result.detail);

    // Apply the context patch.
    if (result.patch?.data) ctx.data = result.patch.data;
    if (result.patch?.connectorResults) ctx.connectorResults = result.patch.connectorResults;
    if (result.patch?.riskDecisions) ctx.riskDecisions = result.patch.riskDecisions;
    if (result.patch?.outcome) ctx.outcome = result.patch.outcome;

    const ctl = result.control;
    if (ctl.kind === "await") {
      lastUi = ctl.ui;
      await persist(ctx, def, "awaiting_input", stepId);
      return view(ctx, def, "awaiting_input", stepId, lastUi);
    }
    if (ctl.kind === "review") {
      await persist(ctx, def, "awaiting_review", stepId);
      return view(ctx, def, "awaiting_review", stepId);
    }
    if (ctl.kind === "done") {
      await persist(ctx, def, "completed", stepId);
      return view(ctx, def, "completed", stepId);
    }
    // continue → route
    const nextId = pickNext(step, ctx, ctl.to);
    if (!nextId) {
      // No route out of a non-terminal step → treat as completed with current outcome.
      await persist(ctx, def, "completed", stepId);
      return view(ctx, def, "completed", stepId);
    }
    stepId = nextId;
  }
  throw new Error(`journey ${def.id}: step budget exceeded (possible cycle)`);
}

function view(ctx: JourneyContext, def: JourneyDef, status: RunStatus, currentStep: string, ui?: ScreenDescriptor): RunView {
  return { runId: ctx.runId, journeyId: def.id, version: def.version, status, currentStep, context: ctx, ui };
}

// ---- public API -------------------------------------------------------------

export async function startJourney(journeyId: string, input: {
  subjectUserId?: string;
  data?: Record<string, CelValue>;
}): Promise<RunView> {
  const def = await loadJourney(journeyId);
  const runId = uuidv4();
  const ctx: JourneyContext = {
    runId,
    journeyId: def.id,
    subjectUserId: input.subjectUserId,
    data: input.data ?? {},
    connectorResults: {},
    riskDecisions: {},
  };
  await getDb().execute(
    `INSERT INTO journey_runs (id, journey_id, version, subject_user_id, status, current_step, context, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    [runId, def.id, def.version, input.subjectUserId ?? null, def.start, JSON.stringify(ctx), new Date().toISOString(), new Date().toISOString()]
  );
  return advance(def, ctx, def.start);
}

/** Resume an awaiting-input run: merge the submitted fields, route past the screen, continue. */
export async function submitStep(runId: string, input: Record<string, CelValue>): Promise<RunView> {
  const { row, ctx, def } = await loadRun(runId);
  if (row.status !== "awaiting_input") throw new Error(`run '${runId}' is ${row.status}, not awaiting input`);
  ctx.data = { ...ctx.data, ...input };
  const next = pickNext(stepById(def, row.current_step), ctx);
  if (!next) { await persist(ctx, def, "completed", row.current_step); return view(ctx, def, "completed", row.current_step); }
  return advance(def, ctx, next);
}

/** Resolve an awaiting-review run: record the human decision and continue. */
export async function resolveReview(runId: string, decision: "approve" | "reject", reason?: string): Promise<RunView> {
  const { row, ctx, def } = await loadRun(runId);
  if (row.status !== "awaiting_review") throw new Error(`run '${runId}' is ${row.status}, not awaiting review`);
  ctx.data = { ...ctx.data, reviewDecision: decision, reviewReason: reason ?? "" };
  const next = pickNext(stepById(def, row.current_step), ctx);
  if (!next) { await persist(ctx, def, "completed", row.current_step); return view(ctx, def, "completed", row.current_step); }
  return advance(def, ctx, next);
}

export async function getRun(runId: string): Promise<RunView> {
  const { row, ctx, def } = await loadRun(runId);
  return view(ctx, def, row.status, row.current_step);
}
