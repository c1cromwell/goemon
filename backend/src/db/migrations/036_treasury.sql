-- X-Money response F1 — tokenized yield-bearing Treasury.
--
-- The competitive counter to a custodial 6% APY: users HOLD a tokenized T-bill
-- (an asset, in their own non-custodial position) and yield ACCRUES to them as an
-- automatic pro-rata distribution (a recurring dividend via corporateActionService).
-- Append-only accrual log; the asset + holdings live in the existing assets/ledger
-- tables, and each distribution is an idempotent ledger journal per holder.

CREATE TABLE IF NOT EXISTS treasury_accruals (
  id                  TEXT PRIMARY KEY,
  asset_id            TEXT NOT NULL,
  corporate_action_id TEXT NOT NULL,
  apy_bps             INTEGER NOT NULL,
  period_days         INTEGER NOT NULL,
  per_unit_minor      INTEGER NOT NULL,   -- yield per token for the period (minor units)
  holders_paid        INTEGER NOT NULL,
  total_minor         INTEGER NOT NULL,
  as_of               TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_treasury_accruals_asset ON treasury_accruals(asset_id, created_at DESC);
