-- X-Money response F5 — collector/creator drops.
--
-- Re-aims X Money's creator-payout hook to tokenized GOODS the creator owns: a
-- creator issues a LIMITED, authenticated tokenized edition (a marketplace asset,
-- kind=collectible, supply = edition size); fans claim editions they OWN
-- (non-custodial), paying the creator DIRECTLY (no ad-revenue middleman). The token +
-- holdings live in the existing assets/ledger tables; each claim is a balanced,
-- idempotent ledger journal. Append-only claim record.

CREATE TABLE IF NOT EXISTS creator_drops (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  edition_size    INTEGER NOT NULL,
  price_minor     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  memo            TEXT,
  cert_number     TEXT,                          -- optional authentication reference
  claimed_count   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active', -- active | sold_out | ended
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_creator_drops_creator ON creator_drops(creator_user_id, created_at DESC);

-- Append-only claims (each is one owned edition token).
CREATE TABLE IF NOT EXISTS drop_claims (
  id             TEXT PRIMARY KEY,
  drop_id        TEXT NOT NULL,
  buyer_user_id  TEXT NOT NULL,
  edition_number INTEGER NOT NULL,
  journal_id     TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drop_claims_buyer ON drop_claims(buyer_user_id, created_at DESC);
