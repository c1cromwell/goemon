/**
 * rules-v1 — the deterministic rule scorer. Ports the Goeman Stage-1 signals
 * (velocity, amount-spike, new-payee, large-absolute) and adds the typologies
 * the plan calls out: structuring, pass-through, mule, and geo/device anomaly.
 *
 * Pure and explainable: every point added emits a Reason (code+weight) and a
 * Contribution (the SHAP-like explanation). This is the production prod-model
 * floor; the sequence model is layered on top via the router/ensemble.
 */

import type { Model } from "./modelTypes";
import { clamp01 } from "./modelTypes";
import type { EnrichedEvent } from "../features/enrichment";
import type { ModelOutput, Reason, Contribution } from "../types";

/** Just-below the common $10k CTR threshold — the classic structuring band. */
const STRUCTURING_LOW = 800_000n; // $8,000
const STRUCTURING_HIGH = 1_000_000n; // $10,000

export class RulesModel implements Model {
  readonly version = "rules-v1";
  readonly kind = "rules" as const;

  score(ev: EnrichedEvent): ModelOutput {
    const reasons: Reason[] = [];
    const explanation: Contribution[] = [];
    let score = 0;

    const add = (code: string, weight: number) => {
      score += weight;
      reasons.push({ code, weight });
      explanation.push({ feature: code, contribution: weight });
    };

    const amount = ev.raw.amountMinor ?? 0n;

    // Velocity — burst-out signal.
    if (ev.velocity >= 10) add("velocity_burst", 0.7);
    else if (ev.velocity >= 6) add("velocity_elevated", 0.3);

    // First-time payee — mild alone, compounds with the rest.
    if (ev.newPayee) add("new_payee", 0.15);

    // Amount spike vs the user's own history.
    if (ev.trailingMaxMinor > 0n && amount > 0n) {
      if (amount >= ev.trailingMaxMinor * 10n && amount >= 200_000n) add("amount_spike_10x", 0.6);
      else if (amount >= ev.trailingMaxMinor * 5n && amount >= 100_000n) add("amount_spike_5x", 0.35);
    }

    // Large absolute single transfer (>= $9,000).
    if (amount >= 900_000n) add("large_absolute", 0.3);

    // Structuring — amount parked just under the $10k reporting threshold.
    if (amount >= STRUCTURING_LOW && amount < STRUCTURING_HIGH) add("structuring_band", 0.3);

    // Pass-through / mule — fresh account moving most of what it just received
    // straight back out to a new payee. Approximated: new payee + amount near the
    // user's whole running balance proxy (total in ≈ total out).
    if (ev.newPayee && ev.features.transferOutCount <= 1 && amount >= 500_000n) {
      add("pass_through", 0.4);
    }

    // Geo / device anomaly — session moved since last seen.
    if (ev.geoChanged) add("geo_anomaly", 0.25);
    if (ev.deviceChanged) add("device_anomaly", 0.2);

    return { score: clamp01(score), reasons, explanation, modelVersion: this.version };
  }
}
