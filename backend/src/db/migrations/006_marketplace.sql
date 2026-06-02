-- Phase 8 — Tokenized RWA & Marketplace.
--
-- Holdings are DERIVED from the double-entry ledger (no holdings table): each
-- asset is a distinct ledger "currency code" (ASSET:<id>) so a trade journal
-- balances per-currency AND per-asset, exactly as cash journals balance per
-- currency. Asset quantities are integer base units (bigint), never float.

CREATE TABLE IF NOT EXISTS assets (
  id                      TEXT PRIMARY KEY,
  kind                    TEXT NOT NULL,                 -- security | collectible | gaming
  token_standard          TEXT NOT NULL,                 -- erc3643 | hts
  hedera_token_id         TEXT,                          -- HTS token id (or simulated)
  issuer_user_id          TEXT REFERENCES users(id),     -- issuer / primary-cash sink
  name                    TEXT NOT NULL,
  symbol                  TEXT,
  decimals                INTEGER NOT NULL DEFAULT 0,    -- display only; ledger uses base units
  metadata                TEXT DEFAULT '{}',
  custody_attestation_uri TEXT,
  min_tier                INTEGER NOT NULL DEFAULT 0,    -- identity tier required to hold
  jurisdiction_allow      TEXT DEFAULT '[]',             -- JSON array; empty = all allowed
  holder_cap              INTEGER,                       -- null = no cap (§12(g) style)
  total_supply            INTEGER NOT NULL DEFAULT 0,    -- base units minted
  status                  TEXT NOT NULL DEFAULT 'active',-- active | paused | delisted
  created_at              TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Listings are VERSIONED and insert-only: each change appends a new version row;
-- the "current" listing is the highest version for an asset. Never UPDATE a row.
CREATE TABLE IF NOT EXISTS listings (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  version      INTEGER NOT NULL,
  surface      TEXT NOT NULL,                            -- invest | collect
  price_minor  INTEGER NOT NULL,                         -- per base unit
  currency     TEXT NOT NULL DEFAULT 'USD',
  price_source TEXT NOT NULL,                            -- nav | spot | orderbook | issuer
  price_as_of  TEXT NOT NULL,
  dd_outcome   TEXT,                                     -- due-diligence outcome
  reviewer     TEXT,                                     -- admin id who set this version
  status       TEXT NOT NULL,                            -- staging | soft | public | paused | delisted
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, version)
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL REFERENCES assets(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  side            TEXT NOT NULL,                         -- buy | sell | subscribe
  qty_base        INTEGER NOT NULL,                      -- integer base units
  price_minor     INTEGER NOT NULL,                      -- executed price per base unit
  currency        TEXT NOT NULL DEFAULT 'USD',
  gross_minor     INTEGER NOT NULL,                      -- qty * price
  fee_minor       INTEGER NOT NULL DEFAULT 0,
  net_minor       INTEGER NOT NULL,                      -- proceeds/cost net of fee
  status          TEXT NOT NULL,                         -- filled | open | cancelled | refunded
  journal_id      TEXT,                                  -- settlement (or escrow) journal
  escrow_journal_id TEXT,                                -- subscribe escrow-in journal
  idempotency_key TEXT UNIQUE,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_asset ON orders(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_asset ON listings(asset_id, version);

-- Jurisdiction for marketplace eligibility (securities transfer gating).
ALTER TABLE identity_profiles ADD COLUMN jurisdiction TEXT DEFAULT 'US';
