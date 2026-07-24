-- Phase 30 — collectible provenance (value/sale/auction history).
--
-- Append-only event log per collectible asset: mint, sale, auction, grade, appraisal.
-- Drives the value-history chart, times-bought/sold, and auction-history panels. Money
-- columns are integer minor units as TEXT (bigint). Populated by collectibleIntelService
-- (simulated provider today; PriceCharting/PSA/auction feeds swap in later).

CREATE TABLE IF NOT EXISTS collectible_provenance (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  event_type   TEXT NOT NULL,                       -- mint | sale | auction | grade | appraisal
  price_minor  TEXT,                                -- bigint; null for non-priced events (grade)
  currency     TEXT NOT NULL DEFAULT 'USD',
  source       TEXT NOT NULL,                       -- simulated | pricecharting | psa | auctions | onchain
  venue        TEXT,                                -- e.g. Barrett-Jackson, RM Sotheby's, eBay
  occurred_at  TEXT NOT NULL,
  detail_json  TEXT DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_collectible_provenance_asset ON collectible_provenance(asset_id, occurred_at);
