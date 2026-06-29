-- USDC → fiat off-ramp (prototype seam). The symmetric exit to the on-ramp: a user sells
-- USDC and receives fiat in a linked bank/card. The licensed provider (MoonPay/Stripe/
-- Coinbase) takes the USDC and delivers the fiat under ITS own license; Goeman debits the
-- user's USDC ledger balance (net of the off-ramp fee) and records the payout reference.
--
-- Money path (balanced, idempotent, append-only ledger journal — see offRampService):
--   sell:  user_cash(USDC) → offramp_settlement(USDC) net,  fee → fee(USDC)
--
-- Money columns are integer minor units as TEXT (bigint), never float/number.

CREATE TABLE IF NOT EXISTS offramp_orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  usdc_amount_minor TEXT NOT NULL,      -- USDC the user sells (micro-units, 6dp)
  fee_minor         TEXT NOT NULL,      -- off-ramp fee (micro-USDC)
  usdc_net_minor    TEXT NOT NULL,      -- USDC converted to fiat (gross - fee)
  fiat_amount_minor TEXT NOT NULL,      -- fiat the user receives (e.g. USD cents)
  fiat_currency     TEXT NOT NULL DEFAULT 'USD',
  asset             TEXT NOT NULL DEFAULT 'USDC',
  rate_ppm          TEXT NOT NULL,      -- USDC→fiat value rate × 1e6 (1:1 = 1e6)
  destination       TEXT,               -- masked linked bank/card (last4)
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  external_ref      TEXT,
  journal_id        TEXT,
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_offramp_orders_user ON offramp_orders(user_id, created_at DESC);
