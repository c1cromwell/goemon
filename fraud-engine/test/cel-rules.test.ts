/**
 * CEL rules seam — evaluator safety, parity with the hardcoded rules-v1,
 * hot-reload, shadow divergence, decision policy, and canary cohort predicate.
 */

import { describe, it, expect } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { freshContext, benignEvent } from "./helpers";
import { getRuleEvaluator, CelError } from "../src/rules/celEvaluator";
import { RulesModel } from "../src/models/rulesModel";
import { CelRulesModel } from "../src/models/celRulesModel";
import { DEFAULT_RULES, DEFAULT_RULE_SET } from "../src/rules/defaultRuleset";
import { loadRuleSet } from "../src/rules/rulesetStore";
import { enrich } from "../src/features/enrichment";
import type { RiskEvent } from "../src/types";

const ev = getRuleEvaluator();
const run = (expr: string, act: Record<string, unknown> = {}) =>
  ev.test(ev.compile(expr), act as Record<string, never>);

describe("CEL subset evaluator — correctness + safety", () => {
  it("evaluates comparisons, boolean logic, arithmetic, membership, ternary", () => {
    expect(run("amount >= 1000 && amount < 2000", { amount: 1500 })).toBe(true);
    expect(run("a > 5 || b", { a: 1, b: true })).toBe(true);
    expect(run("x * 10 >= y", { x: 50, y: 400 })).toBe(true);
    expect(run("channel == 'card'", { channel: "card" })).toBe(true);
    expect(ev.evaluate(ev.compile("score >= 800 ? 'block' : 'allow'"), { score: 900 } as Record<string, never>)).toBe("block");
    expect(run("!flag", { flag: false })).toBe(true);
    expect(run("'x' in tags", { tags: ["x", "y"] })).toBe(true);
  });

  it("respects precedence (&& binds tighter than ||)", () => {
    // false && true || true  ===  (false && true) || true  === true
    expect(run("a && b || c", { a: false, b: true, c: true })).toBe(true);
    // true || false && false  === true || (false && false) === true
    expect(run("a || b && c", { a: true, b: false, c: false })).toBe(true);
  });

  it("rejects a malformed expression at COMPILE time (not a hot-path crash)", () => {
    expect(() => ev.compile("amount >=")).toThrow(CelError);
    expect(() => ev.compile("foo(")).toThrow(CelError);
    expect(() => ev.compile("a &&")).toThrow(CelError);
  });

  it("has no looping/comprehension constructs (bounded, non-Turing-complete)", () => {
    // CEL macros / list comprehensions are intentionally unsupported.
    expect(() => ev.compile("[1,2,3].all(x, x > 0)")).toThrow(CelError);
  });
});

// --- parity ----------------------------------------------------------------

async function enriched(raw: RiskEvent, store: import("../src/features/featureStore").FeatureStore) {
  return enrich(raw, store);
}

describe("rules-cel-v1 ⇄ rules-v1 parity", () => {
  const scenarios: Array<{ name: string; ev: Partial<RiskEvent>; seedFeatures?: Record<string, unknown> }> = [
    { name: "benign small transfer", ev: { amountMinor: 5_000n } },
    { name: "large absolute", ev: { amountMinor: 950_000n } },
    { name: "structuring band", ev: { amountMinor: 850_000n } },
    { name: "new payee pass-through", ev: { amountMinor: 600_000n, counterpartyId: "brand-new-payee" } },
    { name: "geo + device change", ev: { amountMinor: 5_000n, geo: "NG", deviceId: "dev-new" } },
  ];

  for (const sc of scenarios) {
    it(`matches score + reasons: ${sc.name}`, async () => {
      const { db, ctx } = await freshContext();
      // Give the user some history so amount-spike / geo / device have a baseline.
      await db.execute(
        `INSERT INTO user_features (user_id, event_count, transfer_out_count, trailing_max_minor, total_out_minor,
           distinct_payees, recent_event_ts, recent_amounts_minor, last_geo, last_device_id, updated_at)
         VALUES (?, 3, 2, 50000, 100000, '["u-bob"]', '[]', '[50000,50000]', 'US', 'dev-1', ?)`,
        ["u-alice", new Date().toISOString()]
      );

      const raw = benignEvent(sc.ev) as RiskEvent;
      const e = await enriched(raw, ctx.store);

      const hard = new RulesModel().score(e);
      const cel = new CelRulesModel(DEFAULT_RULE_SET, await loadRuleSet(db, DEFAULT_RULE_SET)).score(e);

      expect(cel.score).toBeCloseTo(hard.score, 9);
      expect(cel.reasons.map((r) => r.code).sort()).toEqual(hard.reasons.map((r) => r.code).sort());
    });
  }

  it("seeds and loads the full default ruleset (10 rules) with no compile errors", async () => {
    const { db } = await freshContext();
    const rules = await loadRuleSet(db, DEFAULT_RULE_SET);
    expect(rules.length).toBe(DEFAULT_RULES.length);
    const model = new CelRulesModel(DEFAULT_RULE_SET, rules);
    expect(model.compileErrors).toEqual([]);
    expect(model.ruleCount).toBe(DEFAULT_RULES.length);
  });
});

// --- hot reload + registry -------------------------------------------------

describe("rules-as-data: hot reload + registry adoption", () => {
  it("changing a rule's weight/expr changes scoring with NO code change", async () => {
    const { db, ctx } = await freshContext();
    const raw = benignEvent({ amountMinor: 950_000n }) as RiskEvent;
    const e = await enrich(raw, ctx.store);

    const before = new CelRulesModel(DEFAULT_RULE_SET, await loadRuleSet(db, DEFAULT_RULE_SET)).score(e);
    expect(before.reasons.some((r) => r.code === "large_absolute")).toBe(true);

    // An analyst lowers the large-absolute weight to 0.9 and raises the threshold to $9,600.
    await db.execute(
      "UPDATE rules SET weight = 900, expr = 'amountMinor >= 960000', updated_at = ? WHERE rule_set = ? AND code = 'large_absolute'",
      [new Date().toISOString(), DEFAULT_RULE_SET]
    );
    const after = new CelRulesModel(DEFAULT_RULE_SET, await loadRuleSet(db, DEFAULT_RULE_SET)).score(e);
    // $9,500 no longer trips large_absolute under the new $9,600 threshold.
    expect(after.reasons.some((r) => r.code === "large_absolute")).toBe(false);
  });

  it("registers rules-cel-v1 as shadow; promote flips it to prod with no restart", async () => {
    const { ctx } = await freshContext();
    const rec = await ctx.registry.get(DEFAULT_RULE_SET);
    expect(rec?.status).toBe("shadow");
    expect(ctx.server.has(DEFAULT_RULE_SET)).toBe(true); // it IS being scored
    await ctx.registry.promote(DEFAULT_RULE_SET, "prod");
    expect((await ctx.registry.get(DEFAULT_RULE_SET))?.status).toBe("prod");
  });

  it("a high-risk event is scored by the shadow CEL model alongside prod", async () => {
    const { ctx } = await freshContext();
    const raw = benignEvent({ amountMinor: 950_000n, counterpartyId: "new-1" }) as RiskEvent;
    const decision = await ctx.engine.process(raw);
    // The shadow array carries the CEL model's independent result.
    expect(decision.shadow?.some((s) => s.modelVersion === DEFAULT_RULE_SET)).toBe(true);
  });
});

// --- decision policy (scope #2) --------------------------------------------

describe("CEL decision policy", () => {
  it("a policy row maps score→action when ACTION_POLICY=cel", async () => {
    const { db } = await freshContext();
    const { config } = await import("../src/config");
    const { celActionFor } = await import("../src/router/decisionPolicy");
    await db.execute(
      "INSERT INTO action_policy (id, action, expr, priority, enabled, updated_at) VALUES (?, 'block', ?, 10, 1, ?)",
      [uuidv4(), "score >= 700 || ('pass_through' in reasonCodes && amountMinor > 500000)", new Date().toISOString()]
    );
    expect(config.ACTION_POLICY).toBeDefined();
    const a = await celActionFor(db, { score: 650, mode: "score", amountMinor: 600_000, reasonCodes: ["pass_through"] });
    expect(a).toBe("block");
    const b = await celActionFor(db, { score: 100, mode: "score", amountMinor: 100, reasonCodes: [] });
    expect(b).toBeNull(); // nothing matched → fall back to thresholds
  });
});

// --- canary cohort predicate (scope #3) ------------------------------------

describe("CEL canary cohort predicate", () => {
  it("a cohort_expr gates whether the canary is active for an event", async () => {
    const { db, ctx } = await freshContext();
    // Promote the CEL model to canary at 100% but only for card-channel events.
    await ctx.registry.promote(DEFAULT_RULE_SET, "canary", 100);
    await db.execute("UPDATE models SET cohort_expr = ? WHERE version = ?", ["channel == 'card'", DEFAULT_RULE_SET]);

    // An API-channel event: cohort excludes it → CEL stays shadow (prod = rules-v1).
    const apiDecision = await ctx.engine.process(benignEvent({ amountMinor: 950_000n, channel: "api" }) as RiskEvent);
    expect(apiDecision.modelVersion).not.toBe(DEFAULT_RULE_SET);

    // A card-channel event: cohort matches → CEL canary supplies the effective decision.
    const cardDecision = await ctx.engine.process(benignEvent({ amountMinor: 950_000n, channel: "card", userId: "u-card" }) as RiskEvent);
    expect(cardDecision.modelVersion).toBe(DEFAULT_RULE_SET);
  });
});
