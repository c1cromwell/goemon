/**
 * Ruleset store — reads/seeds the CEL rule rows that drive CelRulesModel.
 *
 * Weights are persisted as INTEGER milli-units (weight × 1000) to keep the "money
 * and scores are integers, never floats" convention; we divide on load. Seeding is
 * idempotent (only inserts when the set is empty), so it is safe on every boot.
 */

import { v4 as uuidv4 } from "uuid";
import type { Db } from "../db";
import type { RuleDef } from "../models/celRulesModel";
import { DEFAULT_RULES, DEFAULT_RULE_SET } from "./defaultRuleset";

interface RuleRow {
  code: string;
  expr: string;
  weight: number;
}

/** Load the enabled rules for a set, newest weight wins. Empty when unseeded. */
export async function loadRuleSet(db: Db, ruleSet: string): Promise<RuleDef[]> {
  const rows = await db.query<RuleRow>(
    "SELECT code, expr, weight FROM rules WHERE rule_set = ? AND enabled = 1 ORDER BY updated_at",
    [ruleSet]
  );
  return rows.map((r) => ({ code: r.code, expr: r.expr, weight: Number(r.weight) / 1000 }));
}

/** Seed the default ruleset once (no-op if it already has rows). */
export async function seedDefaultRuleset(db: Db): Promise<void> {
  const existing = await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM rules WHERE rule_set = ?", [DEFAULT_RULE_SET]);
  if (Number(existing?.n ?? 0) > 0) return;
  const now = new Date().toISOString();
  for (const r of DEFAULT_RULES) {
    await db.execute(
      "INSERT INTO rules (id, rule_set, code, expr, weight, enabled, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [uuidv4(), DEFAULT_RULE_SET, r.code, r.expr, Math.round(r.weight * 1000), now]
    );
  }
}
