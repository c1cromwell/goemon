/**
 * Journey store — load/seed declarative journey definitions and validate their CEL
 * up front (a malformed condition fails at LOAD, never mid-run on a live applicant).
 */

import { getDb } from "../db";
import { compile } from "./cel";
import type { JourneyDef } from "./types";

/** Compile every CEL string in a definition; throws on the first bad expression. */
export function validateJourney(def: JourneyDef): void {
  const stepIds = new Set(def.steps.map((s) => s.id));
  if (!stepIds.has(def.start)) throw new Error(`journey ${def.id}: start '${def.start}' is not a step`);
  for (const s of def.steps) {
    for (const b of s.branches ?? []) {
      compile(b.when); // throws CelError if malformed
      if (!stepIds.has(b.to)) throw new Error(`journey ${def.id}: step ${s.id} branches to unknown '${b.to}'`);
    }
    if (s.next && !stepIds.has(s.next)) throw new Error(`journey ${def.id}: step ${s.id}.next unknown '${s.next}'`);
    const c = (s.config ?? {}) as Record<string, unknown>;
    for (const expr of Object.values((c.assign as Record<string, string>) ?? {})) compile(String(expr));
    for (const expr of Object.values((c.signals as Record<string, string>) ?? {})) compile(String(expr));
    if (typeof c.result === "string") compile(c.result);
  }
}

/** Seed a journey definition (idempotent on id+version). Validates first. */
export async function seedJourney(def: JourneyDef): Promise<void> {
  validateJourney(def);
  const existing = await getDb().queryOne<{ id: string }>("SELECT id FROM journey_defs WHERE id = ? AND version = ?", [def.id, def.version]);
  if (existing) return;
  await getDb().execute(
    "INSERT INTO journey_defs (id, version, title, status, definition, created_at) VALUES (?, ?, ?, 'active', ?, ?)",
    [def.id, def.version, def.title, JSON.stringify(def), new Date().toISOString()]
  );
}

/** Load the most recent active version of a journey. */
export async function loadJourney(journeyId: string): Promise<JourneyDef> {
  const row = await getDb().queryOne<{ definition: string }>(
    "SELECT definition FROM journey_defs WHERE id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [journeyId]
  );
  if (!row) throw new Error(`journey '${journeyId}' not found`);
  return JSON.parse(row.definition) as JourneyDef;
}
