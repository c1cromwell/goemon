-- X-Money response F3 — non-custodial P2P money requests (request-to-pay).
--
-- "Request $X" between users, settled on ARGUS'S OWN RAIL (the double-entry ledger /
-- USDC on Hedera) — no Visa, no partner bank: the payer holds their funds until they
-- choose to fulfill, then it settles via the existing transfer path (executeTransfer,
-- idempotent at the ledger). This is the native, self-contained rail (own-rail goal),
-- and the differentiator vs. X Money: instant, non-custodial, your rail not a network's.
--
-- A request is a lightweight state machine; the MONEY only moves on fulfill, and only
-- as a balanced, idempotent ledger journal (journal_id). No escrow, no hold — a direct
-- peer transfer the payer authorizes.

CREATE TABLE IF NOT EXISTS payment_requests (
  id              TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,             -- who is asking to be paid
  from_user_id    TEXT,                          -- the asked payer (NULL = open request / link)
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  memo            TEXT,
  status          TEXT NOT NULL DEFAULT 'requested', -- requested | fulfilled | declined | canceled | expired
  fulfilled_by    TEXT,                          -- the user who actually paid
  journal_id      TEXT,                          -- the ledger journal that settled it
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_requester ON payment_requests(requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_from ON payment_requests(from_user_id, created_at DESC);
