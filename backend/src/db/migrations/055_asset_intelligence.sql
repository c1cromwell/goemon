-- Phase 30 — Asset intelligence: watchlist (saves) + view tracking.
--
-- Both are per-user-per-asset tables with a UNIQUE(user_id, asset_id) so counts are
-- distinct people (mirrors the ledger holder-count aggregate pattern). asset_views
-- upserts viewed_at, so a returning viewer never double-counts. No money columns.

CREATE TABLE IF NOT EXISTS asset_watchlist (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  created_at TEXT NOT NULL,
  UNIQUE(user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_watchlist_user ON asset_watchlist(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_asset_watchlist_asset ON asset_watchlist(asset_id);

CREATE TABLE IF NOT EXISTS asset_views (
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  viewed_at  TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(asset_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_views_asset ON asset_views(asset_id);
