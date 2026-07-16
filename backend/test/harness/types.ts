/**
 * Agent harness — shared types for step-by-step journey runs.
 * See docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md Phase 0.
 */

export type StepStatus = "PASS" | "FAIL" | "SKIP";

export type JourneyStatus = "PASS" | "FAIL" | "PENDING" | "SKIP";

export interface StepResult {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
  /** Stable ErrorCode when a negative assertion matched (e.g. VP_INVALID). */
  errorCode?: string;
  durationMs?: number;
}

export interface StepContext {
  baseUrl: string;
  /** Optional session bearer from a prior auth step. */
  bearer?: string;
  /** Mutable bag for journey-local state (wallet DID, tokens, etc.). */
  state: Record<string, unknown>;
}

export type StepFn = (ctx: StepContext) => Promise<StepResult>;

export interface StepDef {
  id: string;
  label: string;
  run: StepFn;
}

export interface JourneyDef {
  id: string;
  name: string;
  description?: string;
  steps: StepDef[];
}

export interface JourneyResult {
  id: string;
  name: string;
  status: JourneyStatus;
  steps: StepResult[];
  durationMs: number;
  error?: string;
}

export interface HarnessReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  status: "PASS" | "FAIL";
  journeys: JourneyResult[];
}

export interface RunnerOptions {
  /** Stop a journey on first FAIL (default true). */
  failFast?: boolean;
  /** Max steps per journey (cycle guard). */
  stepBudget?: number;
}
