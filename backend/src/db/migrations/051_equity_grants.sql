-- Phase 29 P4 — employee equity compensation.
--
-- A grant of an `equity` asset to a recipient with a vesting schedule. Award types:
--   unit_award       — restricted units; vested units are delivered on release.
--   profits_interest — LLC profits interest (threshold/hurdle recorded); delivered like a unit award.
--   option           — right to buy units at exercise_price; vested units become exercisable.
-- units_released tracks units delivered (unit_award/profits_interest) OR exercised (option),
-- so a grant is idempotent to advance. Money columns are integer minor units as TEXT (bigint).
-- Grants are mutable (units_released, 83b flag), so NOT append-only. Ties to
-- docs/legal/EQUITY-INCENTIVE-PLAN.md.

CREATE TABLE IF NOT EXISTS equity_grants (
  id                   TEXT PRIMARY KEY,
  asset_id             TEXT NOT NULL REFERENCES assets(id),
  recipient_user_id    TEXT NOT NULL REFERENCES users(id),
  grantor_user_id      TEXT,                         -- the company/issuer that granted (nullable)
  award_type           TEXT NOT NULL,                -- unit_award | profits_interest | option
  units_total          TEXT NOT NULL,                -- bigint: total units under the grant
  units_released       TEXT NOT NULL DEFAULT '0',    -- bigint: delivered (award) or exercised (option)
  exercise_price_minor TEXT NOT NULL DEFAULT '0',    -- bigint: per-unit exercise price (options)
  threshold_minor      TEXT NOT NULL DEFAULT '0',    -- bigint: profits-interest hurdle at grant
  currency             TEXT NOT NULL DEFAULT 'USD',
  vest_start           TEXT NOT NULL,                -- ISO date the schedule starts
  cliff_months         INTEGER NOT NULL DEFAULT 12,
  duration_months      INTEGER NOT NULL DEFAULT 48,
  eighty_three_b_filed INTEGER NOT NULL DEFAULT 0,
  eighty_three_b_deadline TEXT,                      -- vest_start + 30 days (informational)
  status               TEXT NOT NULL DEFAULT 'active', -- active | fully_released | cancelled
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_equity_grants_recipient ON equity_grants(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_equity_grants_asset ON equity_grants(asset_id);
