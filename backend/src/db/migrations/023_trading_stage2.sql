-- Phase 17 Stage 2 — stop orders + market-data CQRS cache.
--
-- Extends orders_trading with stop prices; adds an append-only market-data snapshot
-- store (quotes are ingested off the hot path — docs/PHASE-17-TRADING-BROKERAGE.md).

ALTER TABLE orders_trading ADD COLUMN stop_price_minor INTEGER;

-- Append-only market-data snapshots (CQRS read model; never authoritative for money).
CREATE TABLE IF NOT EXISTS market_data_snapshots (
  id              TEXT PRIMARY KEY,
  instrument_id   TEXT NOT NULL REFERENCES instruments(id),
  bid_minor       INTEGER NOT NULL,
  ask_minor       INTEGER NOT NULL,
  last_minor      INTEGER NOT NULL,
  source          TEXT NOT NULL,                   -- simulated | polygon | iex
  as_of           TEXT NOT NULL,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_data_instrument ON market_data_snapshots(instrument_id, created_at DESC);
