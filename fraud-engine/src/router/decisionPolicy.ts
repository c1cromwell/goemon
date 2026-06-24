/**
 * CEL decision policy (scope #2) — the action ladder as DATA.
 *
 * When ACTION_POLICY=cel, the highest-priority matching `action_policy` row decides
 * the action (e.g. `block if score >= 800 || ('sanctions_hit' in reasonCodes && amountMinor > 500000)`),
 * instead of the fixed routing_config thresholds. Default stays `thresholds`
 * (router.actionFor), so this is fully opt-in and the money path is unchanged until
 * a policy is authored. A malformed policy row is skipped (fail-safe).
 *
 * Programs are compiled once and memoized by expression text — the policy table is
 * small and read per decision, so we avoid recompiling on the hot path.
 */

import type { Db } from "../db";
import type { FraudAction } from "../types";
import { getRuleEvaluator, type CompiledRule, type Activation } from "../rules/celEvaluator";

export interface PolicyActivation {
  score: number; // milli-units (0..1000), matching routing_config thresholds
  mode: string;
  amountMinor: number;
  reasonCodes: string[];
}

const programCache = new Map<string, CompiledRule>();

function compileCached(expr: string): CompiledRule | null {
  const hit = programCache.get(expr);
  if (hit) return hit;
  try {
    const p = getRuleEvaluator().compile(expr);
    programCache.set(expr, p);
    return p;
  } catch {
    return null; // a bad policy row never decides — fall through
  }
}

/** Returns the policy action, or null to fall back to the threshold ladder. */
export async function celActionFor(db: Db, act: PolicyActivation): Promise<FraudAction | null> {
  const rows = await db.query<{ action: string; expr: string }>(
    "SELECT action, expr FROM action_policy WHERE enabled = 1 ORDER BY priority DESC, updated_at"
  );
  const ev = getRuleEvaluator();
  const activation: Activation = {
    score: act.score,
    mode: act.mode,
    amountMinor: act.amountMinor,
    reasonCodes: act.reasonCodes,
  };
  for (const r of rows) {
    const program = compileCached(r.expr);
    if (program && ev.test(program, activation)) return r.action as FraudAction;
  }
  return null;
}
