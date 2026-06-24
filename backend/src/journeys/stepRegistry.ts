/**
 * Step-type registry (Pillar 1) — pluggable handlers for each journey step type.
 *
 * A handler is pure-ish: given the journey context + the step config, it produces a
 * StepResult (a context patch + a control signal). It does NOT route — the runner
 * evaluates the step's CEL branches after the handler returns. New step types are a
 * registry entry, so a journey-builder UI could expose them without engine changes.
 */

import { v4 as uuidv4 } from "uuid";
import type { CelValue } from "./cel";
import type { JourneyContext, ScreenDescriptor, StepDef, StepResult, StepType, UiField } from "./types";
import { waterfall } from "./connectors";
import { assessRisk } from "./riskNode";
import { compile, evaluate } from "./cel";

export interface StepHandler {
  type: StepType;
  execute(ctx: JourneyContext, step: StepDef): Promise<StepResult>;
}

const handlers = new Map<StepType, StepHandler>();
export function registerStepHandler(h: StepHandler): void { handlers.set(h.type, h); }
export function getStepHandler(type: StepType): StepHandler {
  const h = handlers.get(type);
  if (!h) throw new Error(`No handler for step type '${type}'`);
  return h;
}

// Flatten the context into a CEL activation: data fields at top level, plus the
// risk/connector maps under stable keys (so a branch can read `risk.kyc.decision`).
export function toActivation(ctx: JourneyContext): Record<string, CelValue> {
  return { ...ctx.data, risk: ctx.riskDecisions, connectors: ctx.connectorResults };
}

const cfg = (step: StepDef) => (step.config ?? {}) as Record<string, unknown>;

// ---- built-in handlers ------------------------------------------------------

const collectHandler: StepHandler = {
  type: "collect",
  async execute(ctx, step) {
    const c = cfg(step);
    const ui: ScreenDescriptor = {
      screenId: step.id,
      title: String(c.title ?? "Tell us about you"),
      subtitle: c.subtitle ? String(c.subtitle) : undefined,
      fields: (c.fields as UiField[]) ?? [],
      primaryAction: String(c.primaryAction ?? "Continue"),
      kind: "form",
      branding: ctx.data.__branding as ScreenDescriptor["branding"] | undefined,
    };
    return { control: { kind: "await", ui }, detail: { fields: ui.fields.map((f) => f.key) } };
  },
};

const consentHandler: StepHandler = {
  type: "consent",
  async execute(ctx, step) {
    const c = cfg(step);
    const ui: ScreenDescriptor = {
      screenId: step.id,
      title: String(c.title ?? "Terms & disclosures"),
      subtitle: c.subtitle ? String(c.subtitle) : undefined,
      fields: [{ key: "accepted", label: String(c.label ?? "I agree"), type: "checkbox", required: true }],
      primaryAction: String(c.primaryAction ?? "Agree & continue"),
      kind: "consent",
      branding: ctx.data.__branding as ScreenDescriptor["branding"] | undefined,
    };
    return { control: { kind: "await", ui }, detail: { consentVersion: c.version ?? "v1" } };
  },
};

const connectorHandler: StepHandler = {
  type: "connector",
  async execute(ctx, step) {
    const c = cfg(step);
    const ids = (c.connectors as string[]) ?? (c.connector ? [String(c.connector)] : ["simulated"]);
    // Input mapping: pass mapped fields if provided, else the whole data bag.
    const input = (c.input as Record<string, CelValue>) ?? ctx.data;
    const { result, usedId, attempts } = await waterfall(ids, input, { subjectUserId: ctx.subjectUserId });
    return {
      patch: { connectorResults: { ...ctx.connectorResults, [step.id]: { ...result.output, ok: result.ok, usedConnector: usedId } } },
      control: { kind: "continue" },
      detail: { attempts, usedId },
    };
  },
};

const riskHandler: StepHandler = {
  type: "risk_check",
  async execute(ctx, step) {
    const c = cfg(step);
    // Signals: either an explicit map of name → CEL-over-context, or the data bag.
    let signals: Record<string, CelValue>;
    if (c.signals && typeof c.signals === "object") {
      signals = {};
      const act = toActivation(ctx);
      for (const [k, expr] of Object.entries(c.signals as Record<string, string>)) {
        signals[k] = evaluate(compile(String(expr)), act);
      }
    } else {
      signals = ctx.data;
    }
    const d = await assessRisk({ subjectUserId: ctx.subjectUserId, signals });
    return {
      patch: { riskDecisions: { ...ctx.riskDecisions, [step.id]: { decision: d.decision, score: d.score, reasonCodes: d.reasonCodes } } },
      control: { kind: "continue" },
      detail: { decision: d.decision, score: d.score, reasonCodes: d.reasonCodes },
    };
  },
};

const decisionHandler: StepHandler = {
  type: "decision",
  async execute(ctx, step) {
    // `assign`: { field: celExpr } — compute and merge into data (e.g. set a tier).
    const c = cfg(step);
    const assign = (c.assign as Record<string, string>) ?? {};
    const act = toActivation(ctx);
    const patchData: Record<string, CelValue> = {};
    for (const [field, expr] of Object.entries(assign)) {
      patchData[field] = evaluate(compile(String(expr)), act);
    }
    return { patch: { data: { ...ctx.data, ...patchData } }, control: { kind: "continue" }, detail: { assigned: Object.keys(patchData) } };
  },
};

const branchHandler: StepHandler = {
  type: "branch",
  async execute() {
    // Routing-only: the runner evaluates this step's `branches` after we return.
    return { control: { kind: "continue" } };
  },
};

const manualReviewHandler: StepHandler = {
  type: "manual_review",
  async execute() {
    // Queue for a human; the run pauses (awaiting_review) and resumes on resolve.
    return { control: { kind: "review", reviewId: uuidv4() } };
  },
};

const completeHandler: StepHandler = {
  type: "complete",
  async execute(ctx, step) {
    const c = cfg(step);
    const act = toActivation(ctx);
    const result = c.result
      ? String(evaluate(compile(String(c.result)), act))
      : String(ctx.outcome?.result ?? "completed");
    const reasonCodes =
      (c.reasonCodes as string[]) ??
      (ctx.outcome?.reasonCodes ?? []);
    return { patch: { outcome: { result, reasonCodes } }, control: { kind: "done", result, reasonCodes } };
  },
};

export function registerDefaultStepHandlers(): void {
  for (const h of [collectHandler, consentHandler, connectorHandler, riskHandler, decisionHandler, branchHandler, manualReviewHandler, completeHandler]) {
    if (!handlers.has(h.type)) registerStepHandler(h);
  }
}
