-- Phase 21 Stage 1 — "Argus Pay": the native stablecoin-settled payment rail
-- (docs/business/PAYMENT-NETWORK-STRATEGY.md §4/§8).
--
-- Acceptance side: `merchants` are directly-integrated counterparties owned by an
-- Argus user (the settlement account — everything stays on the existing ledger and
-- USDC/Hedera rails). A merchant requests money with a `payment_intent`; the payer
-- (or an authorized agent, via the pay:merchant MCP scope) pays it.
--
-- Every payment is ESCROW-PROTECTED — the chargeback substitute for irreversible
-- settlement: paying an intent holds funds in the escrow layer (escrow_payments),
-- and capture/refund/dispute ride the same balanced, idempotent ledger journals
-- (escrowService). Once paid, an intent's effective status derives from its escrow
-- row — one state machine for money, no dual bookkeeping.
--
-- payment_events is the append-only lifecycle log (added to APPEND_ONLY_TABLES).
-- Money is integer minor units; never float.

CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT PRIMARY KEY,
  owner_user_id   TEXT NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | suspended
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants(id),
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',      -- USD | USDC (USDC settles on Hedera)
  memo            TEXT,
  status          TEXT NOT NULL DEFAULT 'requires_payment', -- requires_payment | paid | canceled | expired
  payer_user_id   TEXT REFERENCES users(id),        -- set when paid
  escrow_id       TEXT REFERENCES escrow_payments(id), -- the protecting escrow once paid
  authorized_via  TEXT,                             -- user | agent (set when paid)
  agent_did       TEXT,                             -- the paying agent's client DID (agent path)
  token_jti       TEXT,                             -- the scoped token that authorized an agent payment
  idempotency_key TEXT UNIQUE,                      -- merchant-side create idempotency
  expires_at      TEXT NOT NULL,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Append-only lifecycle log (immutable, like escrow_events).
CREATE TABLE IF NOT EXISTS payment_events (
  id          TEXT PRIMARY KEY,
  intent_id   TEXT NOT NULL REFERENCES payment_intents(id),
  event       TEXT NOT NULL,                        -- created | paid | captured | refunded | disputed | canceled | expired
  actor       TEXT,                                 -- user id / agent DID / 'system'
  detail      TEXT DEFAULT '{}',                    -- JSON
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merchants_owner ON merchants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_merchant ON payment_intents(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_intents_payer ON payment_intents(payer_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_intent ON payment_events(intent_id, created_at);
