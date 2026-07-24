/**
 * Phase 30 — Asset view tracking. recordView upserts (asset_id, user_id) and bumps a
 * per-viewer counter; distinctViewers is the "how many people viewed" metric. Best-effort:
 * a failure to record a view never blocks the asset-detail read.
 */
import { getDb } from "../db";

export async function recordView(userId: string, assetId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const sql =
    db.dialect === "sqlite"
      ? `INSERT INTO asset_views (asset_id, user_id, viewed_at, view_count) VALUES (?, ?, ?, 1)
         ON CONFLICT (asset_id, user_id) DO UPDATE SET viewed_at = excluded.viewed_at, view_count = asset_views.view_count + 1`
      : `INSERT INTO asset_views (asset_id, user_id, viewed_at, view_count) VALUES (?, ?, ?, 1)
         ON CONFLICT (asset_id, user_id) DO UPDATE SET viewed_at = EXCLUDED.viewed_at, view_count = asset_views.view_count + 1`;
  await db.execute(sql, [assetId, userId, now]);
}

export async function distinctViewers(assetId: string): Promise<number> {
  const row = await getDb().queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM asset_views WHERE asset_id = ?",
    [assetId]
  );
  return Number(row?.n ?? 0);
}

/** Distinct viewer counts for many assets → { assetId: count }. */
export async function viewerCountsForAssets(assetIds: string[]): Promise<Record<string, number>> {
  if (assetIds.length === 0) return {};
  const placeholders = assetIds.map(() => "?").join(",");
  const rows = await getDb().query<{ asset_id: string; n: number }>(
    `SELECT asset_id, COUNT(*) AS n FROM asset_views WHERE asset_id IN (${placeholders}) GROUP BY asset_id`,
    assetIds
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.asset_id] = Number(r.n);
  return out;
}
