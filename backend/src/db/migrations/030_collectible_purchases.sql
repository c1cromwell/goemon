-- In-app collectible purchases — USDC escrow hold → ship → confirm (Corp B posture; no vault partner).

CREATE TABLE IF NOT EXISTS collectible_purchases (
  id                TEXT PRIMARY KEY,
  asset_id          TEXT NOT NULL,
  buyer_user_id     TEXT NOT NULL,
  seller_user_id    TEXT NOT NULL,
  escrow_id         TEXT NOT NULL,
  amount_minor      TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USDC',
  status            TEXT NOT NULL DEFAULT 'escrow_held'
                    CHECK (status IN ('escrow_held', 'shipped', 'completed', 'refunded', 'disputed')),
  shipped_at        TEXT,
  completed_at      TEXT,
  idempotency_key   TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_collectible_purchases_asset ON collectible_purchases(asset_id);
CREATE INDEX IF NOT EXISTS idx_collectible_purchases_buyer ON collectible_purchases(buyer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collectible_purchases_seller ON collectible_purchases(seller_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collectible_purchases_escrow ON collectible_purchases(escrow_id);
