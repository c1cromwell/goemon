/**
 * Journey-as-DATA model — the declarative orchestration platform's core types.
 *
 * A JourneyDef is a versioned DAG of steps (not TS control flow). Each step is a
 * typed node with config + routing (a default `next` and/or CEL `branches`). The
 * runner walks the graph over a JourneyContext, evaluating CEL conditions to route.
 * This is what makes "any account-opening flow" a data artifact a journey-builder
 * UI could author, instead of a code deploy.
 */

import type { CelValue } from "./cel";

// ---- Channel-agnostic Server-Driven UI descriptor (Pillar 2) ----------------
// A `collect`/`consent` step emits one of these; thin web/iOS/Android renderers
// interpret it. The journey defines the UI once; every channel renders it.
export interface UiField {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "date" | "number" | "select" | "checkbox" | "document" | "biometric";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  validation?: string; // a CEL predicate over { value }
}
export interface ScreenDescriptor {
  screenId: string;
  title: string;
  subtitle?: string;
  fields: UiField[];
  primaryAction: string; // button label
  /** Branding tokens — white-label-ready (single-tenant today). */
  branding?: { accent?: string; logoUrl?: string; theme?: "light" | "dark" };
  kind: "form" | "consent" | "review" | "terminal";
}

// ---- Step definitions -------------------------------------------------------
export type StepType =
  | "collect"        // gather data → emits a ScreenDescriptor, awaits input
  | "connector"      // call a vendor/BYO connector (Pillar 3)
  | "risk_check"     // call the fraud/risk engine with journey context (Pillar 4)
  | "decision"       // pure CEL decision → sets an outcome field, routes
  | "branch"         // route-only: first matching CEL branch wins
  | "consent"        // e-sign / disclosures → ScreenDescriptor(consent)
  | "manual_review"  // queue for a human (agent_reviews pattern), pause
  | "complete";      // terminal: emit outcome + reason codes

export interface BranchDef {
  when: string; // CEL predicate over the journey activation
  to: string;   // target step id
}

export interface StepDef {
  id: string;
  type: StepType;
  /** Step-type-specific config (fields, connector ids, CEL expr, outcome map, …). */
  config?: Record<string, unknown>;
  /** Default next step when no branch matches (omit on terminal steps). */
  next?: string;
  /** Conditional routing; first matching branch wins, else `next`. */
  branches?: BranchDef[];
}

export interface JourneyDef {
  id: string;
  version: string;
  title: string;
  start: string; // step id
  steps: StepDef[];
  branding?: ScreenDescriptor["branding"];
}

// ---- Runtime context + results ----------------------------------------------
/** Everything accumulated so far — passed to each step and exposed to CEL. */
export interface JourneyContext {
  runId: string;
  journeyId: string;
  subjectUserId?: string;
  data: Record<string, CelValue>;             // collected attributes
  connectorResults: Record<string, CelValue>; // by connector/step id
  riskDecisions: Record<string, CelValue>;     // by step id: { decision, score, reasonCodes }
  outcome?: { result: string; reasonCodes: string[] };
}

/** What a step handler returns to the runner. */
export type StepControl =
  | { kind: "continue"; to?: string }          // proceed (to overrides default routing)
  | { kind: "await"; ui: ScreenDescriptor }    // pause for user input (resumable)
  | { kind: "review"; reviewId: string }       // pause for a human
  | { kind: "done"; result: string; reasonCodes: string[] }; // terminal

export interface StepResult {
  /** Patches merged into the context (data/connectorResults/riskDecisions/outcome). */
  patch?: Partial<Pick<JourneyContext, "data" | "connectorResults" | "riskDecisions" | "outcome">>;
  control: StepControl;
  /** Diagnostic detail recorded on the append-only step trail. */
  detail?: Record<string, unknown>;
}

export type RunStatus = "running" | "awaiting_input" | "awaiting_review" | "completed";

export interface RunView {
  runId: string;
  journeyId: string;
  version: string;
  status: RunStatus;
  currentStep: string;
  context: JourneyContext;
  ui?: ScreenDescriptor; // present when awaiting input
}
