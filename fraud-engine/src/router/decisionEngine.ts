/**
 * Decision engine — orchestrates the per-event pipeline:
 *
 *   ingest(raw) → persist event → enrich (feature snapshot) → route (prod[+shadow/
 *   canary] scoring) → build Decision → persist to the append-only decisions topic
 *   → fold the event into feature state → publish to the decisions bus.
 *
 * This is the synchronous core used by BOTH the sync (`mode=score`) path and the
 * async consumer. It returns the Decision so the sync caller (Goeman blocking path)
 * gets an immediate advisory; the async path lets the remediation consumer react.
 */

import { v4 as uuidv4 } from "uuid";
import type { Db } from "../db";
import type { FeatureStore } from "../features/featureStore";
import { enrich } from "../features/enrichment";
import type { Router } from "./router";
import type { RiskEvent, Decision } from "../types";
import type { EventBus } from "../bus/eventBus";
import { TOPICS } from "../bus/eventBus";
import { SCHEMA_VERSION } from "../bus/schemaRegistry";
import { decisionTotal, shadowDivergenceTotal, eventsTotal } from "../observability/metrics";

export class DecisionEngine {
  constructor(
    private db: Db,
    private store: FeatureStore,
    private router: Router,
    private decisionBus: EventBus<Decision>
  ) {}

  /** Persist the raw event row. Returns the assigned event id. */
  private async persistEvent(ev: RiskEvent): Promise<string> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO events
         (id, schema_version, event_type, mode, user_id, counterparty_id, channel, amount_minor,
          currency, device_id, ip, geo, idempotency_key, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        SCHEMA_VERSION,
        ev.eventType,
        ev.mode,
        ev.userId,
        ev.counterpartyId ?? null,
        ev.channel ?? null,
        ev.amountMinor ?? null,
        ev.currency ?? null,
        ev.deviceId ?? null,
        ev.ip ?? null,
        ev.geo ?? null,
        ev.idempotencyKey ?? null,
        JSON.stringify({ ...ev, amountMinor: ev.amountMinor?.toString() }),
        new Date().toISOString(),
      ]
    );
    return id;
  }

  async process(ev: RiskEvent): Promise<Decision> {
    eventsTotal.inc({ event_type: ev.eventType, mode: ev.mode });
    const eventId = await this.persistEvent(ev);

    const enriched = await enrich(ev, this.store);
    const routed = await this.router.route(enriched, ev.mode);

    const decision: Decision = {
      decisionId: uuidv4(),
      eventId,
      userId: ev.userId,
      mode: ev.mode,
      score: routed.output.score,
      action: routed.action,
      reasons: routed.output.reasons,
      explanation: routed.output.explanation,
      modelVersion: routed.effectiveModel,
      shadow: routed.shadow,
    };

    await this.db.execute(
      `INSERT INTO decisions
         (id, event_id, user_id, mode, score, action, reasons, explanation, model_version, shadow_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        decision.decisionId,
        eventId,
        ev.userId,
        ev.mode,
        Math.round(decision.score * 1000),
        decision.action,
        JSON.stringify(decision.reasons),
        JSON.stringify(decision.explanation),
        decision.modelVersion,
        JSON.stringify(decision.shadow ?? []),
        new Date().toISOString(),
      ]
    );

    decisionTotal.inc({ action: decision.action, model: decision.modelVersion });
    for (const s of routed.shadow) {
      if (s.action !== decision.action) shadowDivergenceTotal.inc({ model: s.modelVersion });
    }

    // Fold this event into the user's feature state for the NEXT event.
    await this.store.update(ev, new Date().toISOString());

    // Publish to the decisions topic — the remediation consumer listens here.
    await this.decisionBus.publish(TOPICS.decisions, decision);

    return decision;
  }
}
