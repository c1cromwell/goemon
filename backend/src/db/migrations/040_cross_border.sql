-- X-Money response F6 — cross-border send (remittance) on the native rail.
--
-- Send money to another user in a DIFFERENT currency/corridor (e.g. USD/USDC ->
-- EURC), settled on Goemon's own rail: ONE balanced journal across two currency
-- groups joined by the fx_settlement treasury, with the FX spread as a fee. The
-- global, dollar-access audience X Money (US-only via Visa/Cross River/FDIC) can't
-- serve. Append-only record; the money lives in the ledger (journal_id).

CREATE TABLE IF NOT EXISTS cross_border_sends (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  from_currency     TEXT NOT NULL,
  to_currency       TEXT NOT NULL,
  from_amount_minor INTEGER NOT NULL,   -- debited from the sender (FROM ccy)
  gross_to_minor    INTEGER NOT NULL,   -- mid-market converted amount (TO ccy)
  fee_minor         INTEGER NOT NULL,   -- FX spread (TO ccy)
  to_amount_minor   INTEGER NOT NULL,   -- credited to the recipient = gross - fee (TO ccy)
  rate_ppm          INTEGER NOT NULL,
  spread_bps        INTEGER NOT NULL,
  source            TEXT NOT NULL,
  journal_id        TEXT NOT NULL,
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cross_border_sender ON cross_border_sends(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_border_recipient ON cross_border_sends(recipient_user_id, created_at DESC);
