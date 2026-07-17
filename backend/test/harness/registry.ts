/**
 * Journey registry. Phases 1–2 register real j6/j5; j7 remains a placeholder until Phase 3.
 */

import type { JourneyDef } from "./types";
import { j5Journey } from "./journeys/j5-smartchat";
import { j6Journey } from "./journeys/j6-oid4vp-mcp";

const journeys = new Map<string, JourneyDef>();

export function registerJourney(def: JourneyDef): void {
  journeys.set(def.id, def);
}

export function getJourney(id: string): JourneyDef | undefined {
  return journeys.get(id);
}

export function listJourneys(): JourneyDef[] {
  return [...journeys.values()];
}

export function resolveJourneyIds(spec: string | "all"): JourneyDef[] {
  if (spec === "all") return listJourneys();
  const ids = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const out: JourneyDef[] = [];
  for (const id of ids) {
    const j = journeys.get(id);
    if (!j) throw new Error(`Unknown journey '${id}'. Registered: ${[...journeys.keys()].join(", ") || "(none)"}`);
    out.push(j);
  }
  return out;
}

/** Register built-in journeys (real + placeholders). Idempotent. */
export function registerBuiltInJourneys(): void {
  registerJourney(j5Journey);
  registerJourney(j6Journey);
  if (!journeys.has("j7")) {
    registerJourney({
      id: "j7",
      name: "Marketplace subscribe / compliance",
      description: "Placeholder — implemented in harness Phase 3",
      steps: [],
    });
  }
}

/** @deprecated use registerBuiltInJourneys */
export function registerPhase0Placeholders(): void {
  registerBuiltInJourneys();
}
