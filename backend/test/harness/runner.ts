/**
 * Sequential step walker for harness journeys.
 */

import type {
  JourneyDef,
  JourneyResult,
  RunnerOptions,
  StepContext,
  StepResult,
} from "./types";

const DEFAULT_BUDGET = 200;

export async function runJourney(
  journey: JourneyDef,
  baseCtx: Omit<StepContext, "state"> & { state?: Record<string, unknown> },
  opts: RunnerOptions = {}
): Promise<JourneyResult> {
  const failFast = opts.failFast !== false;
  const budget = opts.stepBudget ?? DEFAULT_BUDGET;
  const ctx: StepContext = {
    baseUrl: baseCtx.baseUrl,
    bearer: baseCtx.bearer,
    state: baseCtx.state ?? {},
  };

  const steps: StepResult[] = [];
  const t0 = Date.now();

  if (journey.steps.length === 0) {
    return {
      id: journey.id,
      name: journey.name,
      status: "PASS",
      steps: [],
      durationMs: 0,
    };
  }

  if (journey.steps.length > budget) {
    return {
      id: journey.id,
      name: journey.name,
      status: "FAIL",
      steps: [],
      durationMs: 0,
      error: `Journey exceeds step budget (${journey.steps.length} > ${budget})`,
    };
  }

  for (const step of journey.steps) {
    const s0 = Date.now();
    let result: StepResult;
    try {
      result = await step.run(ctx);
      result.durationMs = result.durationMs ?? Date.now() - s0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        id: step.id,
        label: step.label,
        status: "FAIL",
        detail: msg,
        durationMs: Date.now() - s0,
      };
    }
    steps.push(result);

    if (result.status === "FAIL" && failFast) {
      return {
        id: journey.id,
        name: journey.name,
        status: "FAIL",
        steps,
        durationMs: Date.now() - t0,
        error: result.detail ?? result.label,
      };
    }
  }

  const failed = steps.some((s) => s.status === "FAIL");
  return {
    id: journey.id,
    name: journey.name,
    status: failed ? "FAIL" : "PASS",
    steps,
    durationMs: Date.now() - t0,
  };
}

export async function runJourneys(
  journeys: JourneyDef[],
  baseUrl: string,
  opts: RunnerOptions = {}
): Promise<JourneyResult[]> {
  const results: JourneyResult[] = [];
  for (const j of journeys) {
    results.push(await runJourney(j, { baseUrl }, opts));
  }
  return results;
}
