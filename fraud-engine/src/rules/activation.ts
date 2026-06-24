/**
 * Activation builder — flattens an EnrichedEvent into the CEL variable bindings a
 * rule expression evaluates against.
 *
 * bigint → number boundary: money is integer minor units (bigint) in the engine,
 * but CEL ints are 64-bit. USD/USDC amounts fit comfortably in int64, and JS
 * numbers are exact up to 2^53, well above any realistic minor-unit amount, so the
 * conversion is lossless in practice. The cel-go production evaluator takes int64
 * natively; keep amounts within int64 when extending this.
 */

import type { EnrichedEvent } from "../features/enrichment";
import type { Activation } from "./celEvaluator";

export function toActivation(ev: EnrichedEvent): Activation {
  const amount = ev.raw.amountMinor ?? 0n;
  return {
    // raw event
    eventType: ev.raw.eventType,
    channel: ev.raw.channel ?? "",
    geo: ev.raw.geo ?? "",
    amountMinor: Number(amount),
    // derived features (pre-event state)
    velocity: ev.velocity,
    newPayee: ev.newPayee,
    trailingMaxMinor: Number(ev.trailingMaxMinor),
    avgOutMinor: Number(ev.avgOutMinor),
    transferOutCount: ev.features.transferOutCount,
    eventCount: ev.features.eventCount,
    geoChanged: ev.geoChanged,
    deviceChanged: ev.deviceChanged,
  };
}
