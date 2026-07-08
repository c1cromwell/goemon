-- Wallet extensions: CCTP transfers, push device tokens, mirror inbound events.

CREATE TABLE IF NOT EXISTS cctp_transfers (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  source_chain        TEXT NOT NULL,
  dest_chain          TEXT NOT NULL DEFAULT 'hedera',
  amount_micro        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  external_ref        TEXT,
  idempotency_key     TEXT UNIQUE,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at        TEXT
);

CREATE TABLE IF NOT EXISTS push_device_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at  TEXT,
  UNIQUE(user_id, token)
);

CREATE TABLE IF NOT EXISTS mirror_inbound_events (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  hedera_account_id   TEXT NOT NULL,
  transaction_id      TEXT NOT NULL UNIQUE,
  amount_micro        TEXT,
  token_id            TEXT,
  consensus_at        TEXT,
  notified_at         TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mirror_inbound_user ON mirror_inbound_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS travel_rule_transmissions (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  transmission_id TEXT NOT NULL,
  amount_minor    TEXT NOT NULL,
  currency        TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
