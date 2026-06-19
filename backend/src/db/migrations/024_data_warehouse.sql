-- Phase 20 — Data warehouse export seam (analytics pipeline prototype).
--
-- Incremental, cursor-based export of append-only operational streams to a
-- swappable warehouse sink (simulated default; BigQuery/Snowflake/Redshift stubs).
-- Export runs are append-only history; cursors are mutable checkpoints.

CREATE TABLE IF NOT EXISTS warehouse_export_cursors (
  stream          TEXT PRIMARY KEY,               -- audit_logs | ledger_journals | mcp_audit_logs
  last_id         TEXT NOT NULL,
  last_created_at TEXT NOT NULL,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouse_export_runs (
  id                TEXT PRIMARY KEY,
  result            TEXT NOT NULL,                 -- ok | error | skipped
  streams           TEXT NOT NULL DEFAULT '[]',    -- JSON array of stream names
  records_exported  INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Staging table for the simulated sink (tests + local dev verification).
CREATE TABLE IF NOT EXISTS warehouse_staging_records (
  id          TEXT PRIMARY KEY,
  stream      TEXT NOT NULL,
  payload     TEXT NOT NULL,                       -- JSON row
  exported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warehouse_staging_stream ON warehouse_staging_records(stream, exported_at);
