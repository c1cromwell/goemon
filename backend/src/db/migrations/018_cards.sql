-- Phase 19.4 — debit cards (prototype seam).
--
-- A card spends the user's ledger cash. A purchase is authorized (funds HELD), then the
-- merchant captures (money leaves via external_clearing) or it is voided/expired (hold
-- released). Refunds return money after capture. The hold lives in a `card_holds` system
-- account so held funds are unspendable but still on the books:
--
--   authorize: user_cash      → card_holds        (hold)
--   capture:   card_holds      → external_clearing (settle — money leaves)
--   void:      card_holds      → user_cash         (release)
--   refund:    external_clearing → user_cash       (after capture)
--
-- Only a masked PAN (last4) is ever stored — never the full number/CVV (PCI: the
-- processor holds the PAN). Amounts are integer minor units as text (bigint).

CREATE TABLE IF NOT EXISTS cards (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  network       TEXT NOT NULL DEFAULT 'visa',     -- visa | mastercard (simulated)
  masked_number TEXT NOT NULL,                     -- ••••last4
  exp_month     INTEGER NOT NULL,
  exp_year      INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  processor_ref TEXT,
  status        TEXT NOT NULL DEFAULT 'active',    -- active | frozen | closed
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);

CREATE TABLE IF NOT EXISTS card_authorizations (
  id              TEXT PRIMARY KEY,
  card_id         TEXT NOT NULL REFERENCES cards(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  merchant        TEXT,
  amount_minor    TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'authorized', -- authorized | captured | voided | refunded
  hold_journal_id   TEXT,
  settle_journal_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_card_auth_card ON card_authorizations(card_id);
CREATE INDEX IF NOT EXISTS idx_card_auth_user ON card_authorizations(user_id);
