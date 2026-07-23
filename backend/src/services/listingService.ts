/**
 * Phase 8 — Listing lifecycle (versioned, insert-only).
 *
 * A listing's lifecycle (staging → soft → public → paused → delisted) and price
 * changes are recorded as NEW VERSION ROWS — rows are never updated, so the full
 * history is preserved and pause/delist never destroys holdings (REQ-MK-LIFE-*).
 * The "current" listing is the highest version for an asset.
 *
 * The create/transition flow is a human compliance/admin gate (RBAC enforced at
 * the route). The Phase 15 Marketplace-DD agent later drafts the DD record.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { requireAsset } from "./tokenizationService";
import { getProfile } from "./identityService";

export type ListingStatus = "staging" | "soft" | "public" | "paused" | "delisted";
export type Surface = "invest" | "collect";

const TRADEABLE_STATUSES: ListingStatus[] = ["soft", "public"];

export interface ListingRow {
  id: string;
  asset_id: string;
  version: number;
  surface: Surface;
  price_minor: number | string;
  currency: string;
  price_source: string;
  price_as_of: string;
  dd_outcome: string | null;
  reviewer: string | null;
  status: ListingStatus;
  created_at: string;
}

export interface Listing {
  assetId: string;
  version: number;
  surface: Surface;
  priceMinor: string;
  currency: string;
  priceSource: string;
  priceAsOf: string;
  status: ListingStatus;
  ddOutcome: string | null;
}

function toListing(row: ListingRow): Listing {
  return {
    assetId: row.asset_id,
    version: row.version,
    surface: row.surface,
    priceMinor: BigInt(row.price_minor).toString(),
    currency: row.currency,
    priceSource: row.price_source,
    priceAsOf: row.price_as_of,
    status: row.status,
    ddOutcome: row.dd_outcome,
  };
}

async function currentRow(assetId: string, db = getDb()): Promise<ListingRow | null> {
  return db.queryOne<ListingRow>("SELECT * FROM listings WHERE asset_id = ? ORDER BY version DESC LIMIT 1", [assetId]);
}

export async function getCurrentListing(assetId: string): Promise<Listing | null> {
  const row = await currentRow(assetId);
  return row ? toListing(row) : null;
}

export interface CreateListingInput {
  assetId: string;
  surface: Surface;
  priceMinor: bigint;
  currency?: string;
  priceSource: string;
  ddOutcome?: string;
  reviewer: string;
}

/** Create the first listing version (status 'staging'). */
export async function createListing(input: CreateListingInput): Promise<Listing> {
  await requireAsset(input.assetId);
  if (input.priceMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "priceMinor must be positive");
  const existing = await currentRow(input.assetId);
  if (existing) throw new AppError(ErrorCode.CONFLICT, "Listing already exists; use transition/updatePrice");

  const row = await insertVersion({
    assetId: input.assetId,
    version: 1,
    surface: input.surface,
    priceMinor: input.priceMinor,
    currency: input.currency ?? "USD",
    priceSource: input.priceSource,
    priceAsOf: new Date().toISOString(),
    ddOutcome: input.ddOutcome ?? null,
    reviewer: input.reviewer,
    status: "staging",
  });
  await logAudit({ action: "listing.create", resource: input.assetId, details: { version: 1, status: "staging" } });
  return toListing(row);
}

const ALLOWED_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  staging: ["soft", "delisted"],
  soft: ["public", "paused", "delisted"],
  public: ["paused", "delisted"],
  paused: ["public", "soft", "delisted"],
  delisted: [],
};

/** Append a new version that changes the status (carrying price forward). */
export async function transitionListing(assetId: string, to: ListingStatus, reviewer: string): Promise<Listing> {
  const cur = await currentRow(assetId);
  if (!cur) throw new AppError(ErrorCode.NOT_FOUND, "No listing to transition");
  if (!ALLOWED_TRANSITIONS[cur.status].includes(to)) {
    throw new AppError(ErrorCode.CONFLICT, `Cannot transition listing from ${cur.status} to ${to}`);
  }
  const row = await insertVersion({
    assetId,
    version: cur.version + 1,
    surface: cur.surface,
    priceMinor: BigInt(cur.price_minor),
    currency: cur.currency,
    priceSource: cur.price_source,
    priceAsOf: cur.price_as_of,
    ddOutcome: cur.dd_outcome,
    reviewer,
    status: to,
  });
  await logAudit({ action: "listing.transition", resource: assetId, details: { from: cur.status, to, version: row.version } });
  return toListing(row);
}

/** Append a new version with a new published price (status carried forward). */
export async function updatePrice(assetId: string, priceMinor: bigint, source: string, reviewer: string): Promise<Listing> {
  if (priceMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "priceMinor must be positive");
  const cur = await currentRow(assetId);
  if (!cur) throw new AppError(ErrorCode.NOT_FOUND, "No listing to reprice");
  const row = await insertVersion({
    assetId,
    version: cur.version + 1,
    surface: cur.surface,
    priceMinor,
    currency: cur.currency,
    priceSource: source,
    priceAsOf: new Date().toISOString(),
    ddOutcome: cur.dd_outcome,
    reviewer,
    status: cur.status,
  });
  await logAudit({ action: "listing.reprice", resource: assetId, details: { priceMinor: priceMinor.toString(), source } });
  return toListing(row);
}

interface InsertVersionInput {
  assetId: string;
  version: number;
  surface: Surface;
  priceMinor: bigint;
  currency: string;
  priceSource: string;
  priceAsOf: string;
  ddOutcome: string | null;
  reviewer: string;
  status: ListingStatus;
}

async function insertVersion(v: InsertVersionInput): Promise<ListingRow> {
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO listings (id, asset_id, version, surface, price_minor, currency, price_source, price_as_of, dd_outcome, reviewer, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, v.assetId, v.version, v.surface, v.priceMinor.toString(), v.currency, v.priceSource, v.priceAsOf, v.ddOutcome, v.reviewer, v.status, new Date().toISOString()]
  );
  return (await currentRow(v.assetId))!;
}

export interface ListingView extends Listing {
  name: string;
  symbol: string | null;
  kind: string;
  minTier: number;
  imageUrl: string | null;
  eligible: boolean;
  eligibilityReason?: string;
}

/** Extract a usable image URL from an asset's free-form metadata JSON, if any. */
function imageFromMetadata(metadataJson: string | null | undefined): string | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    for (const k of ["imageUrl", "image", "coverUrl", "photoUrl", "thumbnailUrl"]) {
      const v = meta[k];
      if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
    }
  } catch {
    /* malformed metadata — no image */
  }
  return null;
}

/**
 * Current tradeable listings for a surface, with per-user eligibility (tier +
 * jurisdiction). Only soft/public listings are shown to users.
 */
export async function listForUser(userId: string, surface?: Surface): Promise<ListingView[]> {
  const db = getDb();
  // Latest version per asset, joined to the asset, restricted to tradeable statuses.
  const rows = await db.query<ListingRow & { name: string; symbol: string | null; kind: string; min_tier: number; jurisdiction_allow: string; metadata: string | null }>(
    `SELECT l.*, a.name AS name, a.symbol AS symbol, a.kind AS kind, a.min_tier AS min_tier, a.jurisdiction_allow AS jurisdiction_allow, a.metadata AS metadata
       FROM listings l
       JOIN assets a ON a.id = l.asset_id
      WHERE l.version = (SELECT MAX(version) FROM listings WHERE asset_id = l.asset_id)
        AND l.status IN ('soft','public')
        ${surface ? "AND l.surface = ?" : ""}
      ORDER BY l.created_at DESC`,
    surface ? [surface] : []
  );

  const profile = await getProfile(userId);
  const tier = profile?.tier ?? 0;
  const jurisdiction = (profile as { jurisdiction?: string } | null)?.jurisdiction ?? "US";

  return rows.map((r) => {
    const allow: string[] = JSON.parse(r.jurisdiction_allow || "[]");
    let eligible = true;
    let reason: string | undefined;
    if (tier < r.min_tier) {
      eligible = false;
      reason = `Requires tier ${r.min_tier}`;
    } else if (allow.length > 0 && !allow.includes(jurisdiction)) {
      eligible = false;
      reason = `Not available in ${jurisdiction}`;
    }
    return {
      ...toListing(r),
      name: r.name,
      symbol: r.symbol,
      kind: r.kind,
      minTier: r.min_tier,
      imageUrl: imageFromMetadata(r.metadata),
      eligible,
      eligibilityReason: reason,
    };
  });
}

export function isTradeable(status: ListingStatus): boolean {
  return TRADEABLE_STATUSES.includes(status);
}
