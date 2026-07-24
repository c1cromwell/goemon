/**
 * Phase 30 — Collectible intelligence seam.
 *
 * Swappable provider surfaces the extra signals a collector wants: grade + cert,
 * population report (how many at this grade / higher), comp-vs-ask, subject facts
 * (cards: player/set/year/parallel; cars: make/model/VIN/mileage/matching-numbers/
 * auction results), and value/auction history (collectible_provenance).
 *
 * Providers: simulated (default, offline — deterministic synthetic data) |
 * pricecharting | psa | auctions (NOT_IMPLEMENTED stubs). Illustrative until a real
 * data feed is wired; not an appraisal or investment advice.
 */
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import type { Asset } from "./tokenizationService";
import { collectibleIntelRequestTotal } from "../observability/metrics";

export type CollectibleIntelSource = "simulated" | "pricecharting" | "psa" | "auctions";

export interface ProvenanceEvent {
  eventType: string;
  priceMinor: string | null;
  currency: string;
  venue: string | null;
  occurredAt: string;
}

export interface CollectibleIntel {
  grade: { grader: string; grade: string; certNumber: string | null; verified: boolean } | null;
  population: { grade: string; atGrade: number; higher: number; total: number } | null;
  comp: { compPriceMinor: string; askPriceMinor: string | null; premiumDiscountBps: number; source: string } | null;
  facts: { kind: "card" | "vehicle" | "generic"; fields: Array<{ label: string; value: string }> };
  provenance: ProvenanceEvent[];
  tradeHistory: { timesSold: number; lastSaleMinor: string | null; lastSaleAt: string | null };
  source: CollectibleIntelSource;
  simulated: boolean;
}

interface SubmissionRow {
  grader: string | null;
  cert_number: string | null;
  cert_verified: number | null;
  category: string | null;
  title: string | null;
  ask_usdc_micro: string | null;
  comp_price_minor: string | null;
  comp_source: string | null;
}

/** Stable [0,1) from a string for deterministic synthetic data. */
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

async function loadSubmission(assetId: string): Promise<SubmissionRow | null> {
  return getDb().queryOne<SubmissionRow>(
    `SELECT grader, cert_number, cert_verified, category, title, ask_usdc_micro, comp_price_minor, comp_source
       FROM seller_collectible_submissions WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1`,
    [assetId]
  );
}

async function listProvenance(assetId: string): Promise<ProvenanceEvent[]> {
  const rows = await getDb().query<{
    event_type: string;
    price_minor: string | null;
    currency: string;
    venue: string | null;
    occurred_at: string;
  }>(
    "SELECT event_type, price_minor, currency, venue, occurred_at FROM collectible_provenance WHERE asset_id = ? ORDER BY occurred_at ASC",
    [assetId]
  );
  return rows.map((r) => ({
    eventType: r.event_type,
    priceMinor: r.price_minor,
    currency: r.currency,
    venue: r.venue,
    occurredAt: r.occurred_at,
  }));
}

/**
 * Simulated provider: seed a deterministic value/auction history the first time an
 * asset's intel is requested, so the value-history chart has data offline.
 */
async function ensureSeedProvenance(asset: Asset, basePriceMinor: bigint): Promise<void> {
  const db = getDb();
  const existing = await db.queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM collectible_provenance WHERE asset_id = ?",
    [asset.id]
  );
  if ((existing?.n ?? 0) > 0) return;

  const venues = ["eBay", "Goldin", "Heritage Auctions", "PWCC", "RM Sotheby's"];
  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  const base = basePriceMinor > 0n ? basePriceMinor : 100_00n;
  const rows: Array<[string, string, string | null, string, string]> = [];
  // Mint ~24 months ago, then 5 sales/auctions trending toward the current price.
  for (let i = 0; i < 6; i++) {
    const monthsAgo = 24 - i * 4;
    const at = new Date(now - monthsAgo * monthMs).toISOString();
    if (i === 0) {
      rows.push(["mint", (base / 2n).toString(), asset.id, "onchain", at]);
      continue;
    }
    // deterministic wobble ±18% trending up toward base
    const wobble = (seeded(asset.id + i) - 0.5) * 0.36;
    const trend = 0.5 + (i / 5) * 0.5; // 0.5 → 1.0 of base
    const price = (base * BigInt(Math.round((trend + wobble * 0.2) * 10000))) / 10000n;
    const eventType = i % 2 === 0 ? "auction" : "sale";
    const venue = eventType === "auction" ? venues[i % venues.length]! : "eBay";
    rows.push([eventType, price.toString(), venue, "simulated", at]);
  }
  for (const [eventType, priceMinor, venueOrAsset, source, at] of rows) {
    const isMint = eventType === "mint";
    await db.execute(
      `INSERT INTO collectible_provenance (id, asset_id, event_type, price_minor, currency, source, venue, occurred_at, created_at)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?)`,
      [
        uuidv4(),
        asset.id,
        eventType,
        priceMinor,
        isMint ? "onchain" : source,
        isMint ? null : venueOrAsset,
        at,
        new Date().toISOString(),
      ]
    );
  }
}

function buildFacts(asset: Asset, sub: SubmissionRow | null): CollectibleIntel["facts"] {
  const meta = asset.metadata ?? {};
  // Vehicle if metadata says so (future car verticals) — else treat as a card/generic.
  const vehicle = (meta.vehicle as Record<string, unknown> | undefined) ?? undefined;
  if (vehicle || meta.assetSubtype === "vehicle" || (sub?.category ?? "") === "vehicle") {
    const v = vehicle ?? meta;
    const fields = [
      ["Make", v.make],
      ["Model", v.model],
      ["Year", v.year],
      ["VIN", v.vin],
      ["Mileage", v.mileage],
      ["Matching numbers", v.matchingNumbers],
      ["Provenance", v.provenance ?? v.notableProvenance],
      ["Last auction", v.lastAuction],
    ].filter(([, val]) => val != null) as Array<[string, unknown]>;
    return { kind: "vehicle", fields: fields.map(([label, value]) => ({ label, value: String(value) })) };
  }
  // Card / generic.
  const fields = [
    ["Title", sub?.title ?? asset.name],
    ["Category", sub?.category ?? (meta.category as string | undefined)],
    ["Player / subject", meta.player],
    ["Set", meta.set],
    ["Year", meta.year],
    ["Parallel", meta.parallel],
    ["Serial", meta.serial],
  ].filter(([, val]) => val != null) as Array<[string, unknown]>;
  return { kind: "card", fields: fields.map(([label, value]) => ({ label, value: String(value) })) };
}

const stub = (name: CollectibleIntelSource): never => {
  throw new AppError(
    ErrorCode.NOT_IMPLEMENTED,
    `Collectible intel provider '${name}' is not implemented — wire the real data feed.`
  );
};

export async function getIntel(asset: Asset, listingPriceMinor: bigint | null): Promise<CollectibleIntel> {
  collectibleIntelRequestTotal.inc({ provider: config.COLLECTIBLE_INTEL_PROVIDER });
  if (config.COLLECTIBLE_INTEL_PROVIDER !== "simulated") stub(config.COLLECTIBLE_INTEL_PROVIDER);

  const sub = await loadSubmission(asset.id);
  const meta = asset.metadata ?? {};
  const base = listingPriceMinor ?? (sub?.ask_usdc_micro ? BigInt(sub.ask_usdc_micro) : 100_00n);

  await ensureSeedProvenance(asset, base);
  const provenance = await listProvenance(asset.id);

  // Grade (grade value lives in metadata / cert payload; grader is a submission column).
  const gradeStr = (meta.grade as string | undefined) ?? null;
  const graderStr = sub?.grader ?? (meta.grader as string | undefined) ?? null;
  const grade =
    gradeStr && graderStr
      ? { grader: graderStr, grade: String(gradeStr), certNumber: sub?.cert_number ?? null, verified: !!sub?.cert_verified }
      : null;

  // Population (deterministic synthetic): rarer at higher grades.
  let population: CollectibleIntel["population"] = null;
  if (gradeStr) {
    const r = seeded(asset.id + "pop");
    const atGrade = 1 + Math.floor(r * 400);
    const higher = Math.floor(seeded(asset.id + "higher") * atGrade * 0.4);
    population = { grade: String(gradeStr), atGrade, higher, total: atGrade + higher + Math.floor(r * 2000) };
  }

  // Comp vs ask.
  let comp: CollectibleIntel["comp"] = null;
  if (sub?.comp_price_minor) {
    const compMinor = BigInt(sub.comp_price_minor);
    const ask = listingPriceMinor ?? (sub.ask_usdc_micro ? BigInt(sub.ask_usdc_micro) : null);
    const premiumDiscountBps = ask && compMinor > 0n ? Number(((ask - compMinor) * 10000n) / compMinor) : 0;
    comp = {
      compPriceMinor: compMinor.toString(),
      askPriceMinor: ask ? ask.toString() : null,
      premiumDiscountBps,
      source: sub.comp_source ?? "simulated",
    };
  }

  // Trade history from provenance sales/auctions.
  const sales = provenance.filter((p) => p.eventType === "sale" || p.eventType === "auction");
  const lastSale = sales.length ? sales[sales.length - 1]! : null;

  return {
    grade,
    population,
    comp,
    facts: buildFacts(asset, sub),
    provenance,
    tradeHistory: {
      timesSold: sales.length,
      lastSaleMinor: lastSale?.priceMinor ?? null,
      lastSaleAt: lastSale?.occurredAt ?? null,
    },
    source: "simulated",
    simulated: true,
  };
}
