-- Phase 20 — Ledger⇄chain reconciliation (closes Phase-14 invariant n).
--
-- A reconciliation run compares the internal double-entry ledger's USDC
-- projection against on-chain balances (Hedera Mirror Node):
--   * per-user: user_cash/USDC ledger balance vs the user's on-chain USDC
--   * escrow custodian: the operator's on-chain USDC must cover the `escrow`
--     system account's USDC ledger balance (held funds live at the operator)
--
-- Drift is flagged as findings and GATES on-chain settlement (RECONCILIATION_HOLD)
-- until a clean run. Both tables are append-only (added to APPEND_ONLY_TABLES) —
-- a run is recorded once, after it finishes; history is immutable.
--
-- Money is integer minor units (USDC micro-units); never float.

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL DEFAULT 'usdc',
  result           TEXT NOT NULL,                 -- ok | drift | skipped | error
  accounts_checked INTEGER NOT NULL DEFAULT 0,
  drift_count      INTEGER NOT NULL DEFAULT 0,
  detail           TEXT DEFAULT '{}',             -- JSON (e.g. error message, provider)
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES reconciliation_runs(id),
  subject           TEXT NOT NULL,                -- user:<userId> | escrow_custodian
  hedera_account_id TEXT,
  ledger_minor      INTEGER NOT NULL,             -- USDC micro-units (ledger projection)
  chain_minor       INTEGER NOT NULL,             -- USDC micro-units (on-chain)
  drift_minor       INTEGER NOT NULL,             -- chain - ledger
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recon_runs_created ON reconciliation_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_recon_findings_run ON reconciliation_findings(run_id);
