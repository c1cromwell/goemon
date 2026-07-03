-- Phase 29 P5 — capital formation / primary-raise rails.
--
-- An `offering` is a company raising capital by selling units of a tokenized asset under a
-- securities exemption. Investors commit funds (escrowed); at close the raise either SETTLES
-- (deliver units to each investor + release escrow to the issuer) if the target is met, or
-- REFUNDS everyone. Money columns are integer minor units as TEXT (bigint). Not append-only
-- (status transitions). Ties to docs/TOKENIZATION-MASTER-PLAN.md (P5).

CREATE TABLE IF NOT EXISTS offerings (
  id                    TEXT PRIMARY KEY,
  asset_id              TEXT NOT NULL REFERENCES assets(id),
  issuer_user_id        TEXT NOT NULL REFERENCES users(id),
  exemption             TEXT NOT NULL,               -- reg_cf | reg_d_506c | reg_a
  price_minor           TEXT NOT NULL,               -- bigint: price per unit
  currency              TEXT NOT NULL DEFAULT 'USD',
  target_minor          TEXT NOT NULL,               -- bigint: min raised to settle
  cap_minor             TEXT NOT NULL,               -- bigint: max raised
  min_investment_minor  TEXT NOT NULL DEFAULT '0',
  max_investment_minor  TEXT,                        -- bigint or null (no per-investor cap)
  status                TEXT NOT NULL DEFAULT 'open',-- open | settled | refunded | cancelled
  opened_at             TEXT NOT NULL,
  closes_at             TEXT,
  closed_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_offerings_asset ON offerings(asset_id);
CREATE INDEX IF NOT EXISTS idx_offerings_status ON offerings(status);

CREATE TABLE IF NOT EXISTS offering_investments (
  id                TEXT PRIMARY KEY,
  offering_id       TEXT NOT NULL REFERENCES offerings(id),
  investor_user_id  TEXT NOT NULL REFERENCES users(id),
  units             TEXT NOT NULL,                   -- bigint
  amount_minor      TEXT NOT NULL,                   -- bigint: units * price
  status            TEXT NOT NULL DEFAULT 'committed',-- committed | settled | refunded
  escrow_journal_id TEXT,                            -- the commit (escrow-in) journal
  settle_journal_id TEXT,                            -- the settle/refund journal
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offering_investments_offering ON offering_investments(offering_id);
CREATE INDEX IF NOT EXISTS idx_offering_investments_investor ON offering_investments(investor_user_id);
