/**
 * Phase 30 — Watchlist (save an asset). Per-user-per-asset rows; the saver count
 * for an asset is a distinct-user COUNT (mirrors ledgerService.getAssetHolderCount).
 */
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { watchlistOpTotal } from "../observability/metrics";

export async function add(userId: string, assetId: string): Promise<void> {
  const db = getDb();
  // Idempotent: UNIQUE(user_id, asset_id) makes a repeat add a no-op.
  const sql =
    db.dialect === "sqlite"
      ? "INSERT OR IGNORE INTO asset_watchlist (id, user_id, asset_id, created_at) VALUES (?, ?, ?, ?)"
      : "INSERT INTO asset_watchlist (id, user_id, asset_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, asset_id) DO NOTHING";
  await db.execute(sql, [uuidv4(), userId, assetId, new Date().toISOString()]);
  watchlistOpTotal.inc({ op: "add" });
}

export async function remove(userId: string, assetId: string): Promise<void> {
  await getDb().execute("DELETE FROM asset_watchlist WHERE user_id = ? AND asset_id = ?", [userId, assetId]);
  watchlistOpTotal.inc({ op: "remove" });
}

export async function isWatched(userId: string, assetId: string): Promise<boolean> {
  const row = await getDb().queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM asset_watchlist WHERE user_id = ? AND asset_id = ?",
    [userId, assetId]
  );
  return (row?.n ?? 0) > 0;
}

/** Asset ids a user has saved, newest first. */
export async function listAssetIds(userId: string): Promise<string[]> {
  const rows = await getDb().query<{ asset_id: string }>(
    "SELECT asset_id FROM asset_watchlist WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  return rows.map((r) => r.asset_id);
}

export async function countForAsset(assetId: string): Promise<number> {
  const row = await getDb().queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM asset_watchlist WHERE asset_id = ?",
    [assetId]
  );
  return Number(row?.n ?? 0);
}

/** Saver counts for many assets in one query → { assetId: count }. */
export async function countsForAssets(assetIds: string[]): Promise<Record<string, number>> {
  if (assetIds.length === 0) return {};
  const placeholders = assetIds.map(() => "?").join(",");
  const rows = await getDb().query<{ asset_id: string; n: number }>(
    `SELECT asset_id, COUNT(*) AS n FROM asset_watchlist WHERE asset_id IN (${placeholders}) GROUP BY asset_id`,
    assetIds
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.asset_id] = Number(r.n);
  return out;
}

/** Which of these assets the user has saved → Set of asset ids. */
export async function watchedSet(userId: string, assetIds: string[]): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const placeholders = assetIds.map(() => "?").join(",");
  const rows = await getDb().query<{ asset_id: string }>(
    `SELECT asset_id FROM asset_watchlist WHERE user_id = ? AND asset_id IN (${placeholders})`,
    [userId, ...assetIds]
  );
  return new Set(rows.map((r) => r.asset_id));
}
