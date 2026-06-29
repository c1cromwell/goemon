-- Phase 20 — fraud remediation callback targets.
--
-- The standalone fraud engine (the `fraud-engine/` add-on) reacts to fire-and-
-- forget events asynchronously and, on a severe decision, calls back into Goemon
-- to FREEZE an account or FLAG a transaction. These tables are that landing zone.
--
-- Both are APPEND-ONLY (UPDATE/DELETE blocked by triggers in migrate.ts, like
-- audit_logs / escrow_events). An account's frozen state DERIVES from the holds
-- log (a 'place' with no later 'release'), the same way a payment's status
-- derives from its escrow row — one event-sourced state machine, no mutable flag.

CREATE TABLE IF NOT EXISTS account_holds (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,            -- place | release
  reason      TEXT,
  source      TEXT NOT NULL,            -- fraud_engine | admin
  decision_id TEXT,                     -- the engine decision that drove this (idempotency key)
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_holds_user ON account_holds(user_id, created_at);

CREATE TABLE IF NOT EXISTS transaction_flags (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  transaction_ref TEXT NOT NULL,        -- a journal id / transaction id / idempotency key
  reason          TEXT,
  source          TEXT NOT NULL,        -- fraud_engine | admin
  decision_id     TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transaction_flags_user ON transaction_flags(user_id, created_at);
