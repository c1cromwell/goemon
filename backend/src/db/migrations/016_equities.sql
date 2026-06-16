-- Phase 18.6 — tokenized 1:1-backed public equities (prototype seam).
--
-- Equities reuse the Phase-8 asset model (assets.kind is free TEXT; 'equity' is now a
-- valid kind, treated as a security by complianceService). Only two things are new:
--
--   * corporate_actions — APPEND-ONLY declaration of a dividend/split (immutable record;
--     UPDATE/DELETE blocked by trigger, like audit_logs). Whether a dividend has been
--     distributed is derived from the per-holder payout journals (idempotent), so no
--     mutable status is needed here.
--   * redemptions       — a MUTABLE state machine (requested → settled | failed) for a
--     holder burning tokens to redeem the underlying; deliberately NOT append-only.
--
-- amount_per_unit_minor is integer minor units of `currency` per ONE whole unit of the
-- asset (per-share dividend); payout = amount_per_unit_minor * qtyBase / 10^decimals,
-- computed in bigint (never float). qty_base is integer base units, like all holdings.

CREATE TABLE IF NOT EXISTS corporate_actions (
  id                    TEXT PRIMARY KEY,
  asset_id              TEXT NOT NULL REFERENCES assets(id),
  type                  TEXT NOT NULL,            -- dividend | split
  amount_per_unit_minor TEXT NOT NULL DEFAULT '0',-- bigint as text; dividend cash per whole share
  currency              TEXT NOT NULL DEFAULT 'USD',
  ex_date               TEXT,
  record_date           TEXT,
  pay_date              TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corporate_actions_asset ON corporate_actions(asset_id);

CREATE TABLE IF NOT EXISTS redemptions (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  qty_base     TEXT NOT NULL,                     -- bigint as text (base units burned)
  proceeds_minor TEXT,                            -- bigint as text (cash delivered), null until settled
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'requested', -- requested | settled | failed
  external_ref TEXT,                              -- issuer/on-chain reference
  journal_id   TEXT,                              -- the settlement journal (idempotency link)
  created_at   TEXT NOT NULL,
  settled_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_id);
