-- Phase 10 / Hedera non-custodial send — build → sign (device) → submit split.
--
-- Stores frozen transaction bytes between /transfer/build and /transfer/submit.
-- Rows are mutable (status advances pending → submitted); not append-only.

CREATE TABLE IF NOT EXISTS hedera_transfer_builds (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id),
  to_hedera_account_id  TEXT NOT NULL,
  to_user_id            TEXT,
  amount_micro          INTEGER NOT NULL,
  frozen_tx_bytes       TEXT NOT NULL,              -- base64 frozen TransferTransaction
  idempotency_key       TEXT UNIQUE,
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | submitted
  transaction_id        TEXT,
  journal_id            TEXT,
  created_at            TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hedera_builds_user ON hedera_transfer_builds(user_id, created_at DESC);
