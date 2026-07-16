/**
 * Journey registry. Phase 0: empty. Phase 1–3 register j6, j5, j7.
 */

import type { JourneyDef } from "./types";

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

/** Phase 0: no product journeys yet — register stubs so --all / --journey j6 are discoverable. */
export function registerPhase0Placeholders(): void {
  for (const id of ["j5", "j6", "j7"] as const) {
    if (journeys.has(id)) continue;
    registerJourney({
      id,
      name: placeholderName(id),
      description: `Placeholder — implemented in harness Phase ${id === "j6" ? "1" : id === "j5" ? "2" : "3"}`,
      steps: [],
    });
  }
}

function placeholderName(id: string): string {
  switch (id) {
    case "j5":
      return "SmartChat NL → MFA → transfer";
    case "j6":
      return "OID4VP → VP verify → MCP";
    case "j7":
      return "Marketplace subscribe / compliance";
    default:
      return id;
  }
}
