-- FX quote seam — append-only snapshot of conversion quotes (quote-only; never
-- authoritative for money). Mirrors market_data_snapshots: an off-the-hot-path
-- read model kept for history/analytics. Cross-currency *settlement* (a journal
-- that converts) is a later stage and does not touch this table.

CREATE TABLE IF NOT EXISTS fx_quotes (
  id                TEXT PRIMARY KEY,
  from_currency     TEXT NOT NULL,
  to_currency       TEXT NOT NULL,
  from_amount_minor INTEGER NOT NULL,
  to_amount_minor   INTEGER NOT NULL,
  rate_ppm          INTEGER NOT NULL,   -- rate * 1e6 (integer; avoids float)
  source            TEXT NOT NULL,      -- simulated | circle | oanda
  as_of             TEXT NOT NULL,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fx_quotes_pair ON fx_quotes(from_currency, to_currency, created_at DESC);
