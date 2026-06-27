-- Collateralized lending (prototype; PRD v2). Over-collateralized loans: a user pledges
-- a tokenized holding (valued at par — e.g. the Treasury ATB) into a system collateral
-- account and borrows USD against it without selling, keeping the asset to reclaim on
-- repayment. Interest accrues on the outstanding principal; the loan is liquidated if the
-- debt breaches the liquidation LTV against the collateral value.
--
-- Every money/asset move is a balanced, idempotent ledger journal (see lendingService):
--   open:       lending_pool(USD) → user_cash(USD)         + asset: user_asset → loan_collateral
--   repay:      user_cash(USD) → lending_pool(principal) + fee(interest)
--   release:    loan_collateral → user_asset                (on full repayment)
--   liquidate:  liquidation_settlement(USD) → pool/fee/user-surplus + asset seize
--
-- Money columns are integer minor units as TEXT (bigint), never float/number.

CREATE TABLE IF NOT EXISTS loans (
  id                          TEXT PRIMARY KEY,
  user_id                     TEXT NOT NULL,
  collateral_asset_id         TEXT NOT NULL,
  collateral_qty_base         TEXT NOT NULL,   -- pledged token quantity (base units)
  borrow_currency             TEXT NOT NULL DEFAULT 'USD',
  principal_minor             TEXT NOT NULL,   -- original amount borrowed
  principal_outstanding_minor TEXT NOT NULL,   -- remaining principal
  accrued_interest_minor      TEXT NOT NULL DEFAULT '0',
  apr_bps                     INTEGER NOT NULL,
  max_ltv_bps                 INTEGER NOT NULL,
  liquidation_ltv_bps         INTEGER NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'active', -- active | repaid | liquidated
  open_journal_id             TEXT,
  accrued_through             TEXT NOT NULL,   -- interest-accrual cursor (ISO)
  opened_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at                   TEXT,
  idempotency_key             TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
