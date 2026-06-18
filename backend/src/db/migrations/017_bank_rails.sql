-- Phase 19 Stage-1 — full-bank rails (fiat on/off-ramp, ACH/wire payouts) prototype.
--
-- Money moves between the partner bank (the FBO that actually holds customer fiat) and
-- the ledger's existing `external_clearing` system account — the documented attach seam.
-- Customer balances are the ledger's user_cash (FBO-backed at the partner bank in prod).
--
--   * bank_transfers — a MUTABLE state machine for a deposit/withdrawal:
--       requested → settled | failed | returned   (NOT append-only; the immutable record
--       is the ledger journal + transactions row + audit_logs).
--   * bank_accounts  — a customer's linked external bank account (payout destination).
--
-- amount_minor / proceeds are integer minor units as text (bigint), never float.

CREATE TABLE IF NOT EXISTS bank_transfers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  direction       TEXT NOT NULL,                 -- in (deposit) | out (withdrawal)
  method          TEXT NOT NULL DEFAULT 'ach',   -- ach | wire | instant
  amount_minor    TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'requested', -- requested | settled | failed | returned
  counterparty    TEXT,                          -- masked external account / reference
  external_ref    TEXT,                          -- partner-bank reference
  journal_id      TEXT,                          -- settlement journal (idempotency link)
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL,
  settled_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_transfers_user ON bank_transfers(user_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  label         TEXT,
  type          TEXT NOT NULL DEFAULT 'checking', -- checking | savings
  masked_number TEXT NOT NULL,                    -- last4 only; never store full PAN/acct
  routing       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | removed
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id);
