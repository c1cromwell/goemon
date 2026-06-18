-- Phase 19.3 — bill pay (prototype seam).
--
-- A bill payment is a directed payout to a registered payee (biller). It rides the same
-- partner-bank rail as withdrawals and settles via the ledger's external_clearing:
--   send: user_cash → external_clearing   (money leaves to the biller)
-- Payments may be immediate or scheduled, and a payment can recur (weekly/monthly) — on
-- send, a recurring payment seeds its next scheduled instance.
--
--   * bill_payees   — a customer's saved biller (masked account ref only).
--   * bill_payments — a MUTABLE state machine: scheduled → sent | canceled | failed.
-- Amounts are integer minor units as text (bigint), never float.

CREATE TABLE IF NOT EXISTS bill_payees (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  category      TEXT,
  masked_account TEXT,                            -- ••••last4 of the biller account
  status        TEXT NOT NULL DEFAULT 'active',   -- active | removed
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bill_payees_user ON bill_payees(user_id);

CREATE TABLE IF NOT EXISTS bill_payments (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  payee_id        TEXT NOT NULL REFERENCES bill_payees(id),
  amount_minor    TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sent | canceled | failed
  recurrence      TEXT NOT NULL DEFAULT 'none',      -- none | weekly | monthly
  scheduled_for   TEXT NOT NULL,                     -- ISO; <= now ⇒ due
  journal_id      TEXT,
  external_ref    TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL,
  sent_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_bill_payments_user ON bill_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_due ON bill_payments(status, scheduled_for);
