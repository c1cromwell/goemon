-- Phase A competitive gap plan — collectibles provider sync (Courtyard seam).
-- External listing inventory keyed by provider + external_id; append-only sync runs.

CREATE TABLE IF NOT EXISTS collectibles_sync_runs (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  items_fetched INTEGER NOT NULL DEFAULT 0,
  items_upserted INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS external_collectible_listings (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  asset_id        TEXT,
  title           TEXT NOT NULL,
  category        TEXT,
  ask_usdc_micro  TEXT NOT NULL,
  image_url       TEXT,
  custody_vault   TEXT,
  grade           TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  synced_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_collectibles_provider ON external_collectible_listings(provider, status);
