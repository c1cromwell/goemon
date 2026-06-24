/**
 * rules-cel-v1 — the CEL-expressed rule scorer.
 *
 * Same contract and explainability as the hardcoded RulesModel (rules-v1): each
 * fired rule adds its weight and emits a Reason + Contribution. The difference is
 * that the rules are DATA — `{code, expr, weight}` rows authored as CEL — not code.
 * A fraud analyst tunes a threshold or adds a typology by editing a row; promotion
 * to prod is a registry status change (shadow → canary → prod), no redeploy.
 *
 * Expressions are compiled once at load (program cache); scoring only evaluates,
 * which is bounded and cannot throw for control flow. A rule whose expression
 * fails to compile is skipped and surfaced via `compileErrors` (fail-safe: a bad
 * analyst rule never takes down scoring).
 */

import type { Model } from "./modelTypes";
import { clamp01 } from "./modelTypes";
import type { EnrichedEvent } from "../features/enrichment";
import type { ModelOutput, Reason, Contribution } from "../types";
import { getRuleEvaluator, type RuleEvaluator, type CompiledRule, CelError } from "../rules/celEvaluator";
import { toActivation } from "../rules/activation";

export interface RuleDef {
  code: string;
  expr: string;
  weight: number;
}

interface CompiledEntry {
  code: string;
  weight: number;
  program: CompiledRule;
}

export class CelRulesModel implements Model {
  readonly kind = "rules" as const;
  private compiled: CompiledEntry[] = [];
  readonly compileErrors: Array<{ code: string; error: string }> = [];

  constructor(
    readonly version: string,
    rules: RuleDef[],
    private evaluator: RuleEvaluator = getRuleEvaluator()
  ) {
    for (const r of rules) {
      try {
        this.compiled.push({ code: r.code, weight: r.weight, program: this.evaluator.compile(r.expr) });
      } catch (e) {
        this.compileErrors.push({ code: r.code, error: e instanceof CelError ? e.message : String(e) });
      }
    }
  }

  /** Number of rules that compiled cleanly (for diagnostics/tests). */
  get ruleCount(): number {
    return this.compiled.length;
  }

  score(ev: EnrichedEvent): ModelOutput {
    const activation = toActivation(ev);
    const reasons: Reason[] = [];
    const explanation: Contribution[] = [];
    let score = 0;

    for (const r of this.compiled) {
      if (this.evaluator.test(r.program, activation)) {
        score += r.weight;
        reasons.push({ code: r.code, weight: r.weight });
        explanation.push({ feature: r.code, contribution: r.weight });
      }
    }

    return { score: clamp01(score), reasons, explanation, modelVersion: this.version };
  }
}
