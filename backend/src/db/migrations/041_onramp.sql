-- Fiat → USDC on-ramp (prototype seam). Buy USDC with fiat — the activation gap.
--
-- Phase-A posture: the real providers (MoonPay/Stripe Crypto/Coinbase) take the
-- fiat + run KYC under THEIR license and deliver USDC; Goeman never custodies the
-- fiat. The prototype's simulated provider models the delivery: USDC is credited to
-- the user's ledger balance via a balanced journal (onramp_settlement → user_cash,
-- minus an on-ramp fee). Append-only order record; money lives in the ledger.

CREATE TABLE IF NOT EXISTS onramp_orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  -- money columns are integer minor units as TEXT (bigint), never float/number.
  fiat_amount_minor TEXT NOT NULL,      -- what the user pays (e.g. USD cents)
  fiat_currency     TEXT NOT NULL DEFAULT 'USD',
  asset             TEXT NOT NULL DEFAULT 'USDC',
  usdc_gross_minor  TEXT NOT NULL,      -- USDC delivered before fee (micro-units, 6dp)
  fee_minor         TEXT NOT NULL,      -- on-ramp fee (micro-USDC)
  usdc_net_minor    TEXT NOT NULL,      -- credited to the user (micro-USDC)
  rate_ppm          INTEGER NOT NULL,   -- fiat→USDC value rate × 1e6 (1:1 = 1e6)
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  external_ref      TEXT,                -- the provider's order id
  redirect_url      TEXT,                -- hosted-widget URL for real providers
  journal_id        TEXT,                -- the ledger journal that delivered the USDC
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_onramp_orders_user ON onramp_orders(user_id, created_at DESC);
