-- Phase 15.3 — compliance reporting deadlines.
--
-- A human-review item can carry a regulatory deadline (SAR 30d, OFAC blocking 10d,
-- CTR 15d, fuzzy sanctions hit 24h). due_at is when the human gate must be resolved by;
-- overdue items are surfaced via /api/admin/agent-ops/reviews/overdue. Nullable so
-- non-compliance reviews (e.g. KYC) are unaffected.

ALTER TABLE agent_reviews ADD COLUMN due_at TEXT;
