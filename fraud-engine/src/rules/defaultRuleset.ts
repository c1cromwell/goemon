/**
 * The default CEL ruleset — a faithful port of the hardcoded rules-v1
 * (src/models/rulesModel.ts) into CEL expressions, used to seed the `rules` table
 * and to prove parity between the two models.
 *
 * Note the two mutually-exclusive ladders from rules-v1 are preserved explicitly:
 *   - velocity: burst (>=10) OR elevated (>=6 and <10), never both;
 *   - amount spike: 10x fires, else 5x — so the 5x predicate excludes the 10x case.
 */

import type { RuleDef } from "../models/celRulesModel";

export const DEFAULT_RULE_SET = "rules-cel-v1";

export const DEFAULT_RULES: RuleDef[] = [
  { code: "velocity_burst", expr: "velocity >= 10", weight: 0.7 },
  { code: "velocity_elevated", expr: "velocity >= 6 && velocity < 10", weight: 0.3 },
  { code: "new_payee", expr: "newPayee", weight: 0.15 },
  {
    code: "amount_spike_10x",
    expr: "trailingMaxMinor > 0 && amountMinor > 0 && amountMinor >= trailingMaxMinor * 10 && amountMinor >= 200000",
    weight: 0.6,
  },
  {
    code: "amount_spike_5x",
    // 5x band, but only when the 10x band did NOT fire (rules-v1 else-if).
    expr:
      "trailingMaxMinor > 0 && amountMinor > 0 && amountMinor >= trailingMaxMinor * 5 && amountMinor >= 100000 " +
      "&& !(amountMinor >= trailingMaxMinor * 10 && amountMinor >= 200000)",
    weight: 0.35,
  },
  { code: "large_absolute", expr: "amountMinor >= 900000", weight: 0.3 },
  { code: "structuring_band", expr: "amountMinor >= 800000 && amountMinor < 1000000", weight: 0.3 },
  { code: "pass_through", expr: "newPayee && transferOutCount <= 1 && amountMinor >= 500000", weight: 0.4 },
  { code: "geo_anomaly", expr: "geoChanged", weight: 0.25 },
  { code: "device_anomaly", expr: "deviceChanged", weight: 0.2 },
];
