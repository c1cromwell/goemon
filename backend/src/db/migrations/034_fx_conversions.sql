-- Cross-currency settlement — append-only record of executed conversions.
--
-- A conversion debits the user's FROM balance and credits their TO balance at a
-- quoted rate, with an explicit spread fee, as ONE balanced journal: each currency
-- group nets to zero independently (FROM: user→fx_settlement; TO: fx_settlement→
-- user + fee). The fx_settlement system account carries the cross-currency position
-- (the treasury FX book). This table is the audit record; the money lives in the
-- ledger (journal_id), never here.

CREATE TABLE IF NOT EXISTS fx_conversions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  from_currency     TEXT NOT NULL,
  to_currency       TEXT NOT NULL,
  from_amount_minor INTEGER NOT NULL,   -- debited from the user (FROM ccy)
  gross_to_minor    INTEGER NOT NULL,   -- mid-market converted amount (TO ccy)
  fee_minor         INTEGER NOT NULL,   -- spread fee (TO ccy)
  to_amount_minor   INTEGER NOT NULL,   -- credited to the user = gross - fee (TO ccy)
  rate_ppm          INTEGER NOT NULL,   -- rate * 1e6
  spread_bps        INTEGER NOT NULL,
  source            TEXT NOT NULL,      -- simulated | circle | oanda
  journal_id        TEXT NOT NULL REFERENCES ledger_journals(id),
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fx_conversions_user ON fx_conversions(user_id, created_at DESC);
