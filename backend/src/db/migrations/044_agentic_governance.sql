-- M2 — Agentic OS governance: CEO/CS gates + milestone sign-offs.

ALTER TABLE agent_reviews ADD COLUMN output_class TEXT;
ALTER TABLE agent_reviews ADD COLUMN gate_category TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_reviews_output_class ON agent_reviews(output_class);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_gate_category ON agent_reviews(gate_category);

-- CEO milestone deploy sign-offs (M1, M2, …) — separate from runtime agent_reviews.
CREATE TABLE IF NOT EXISTS ceo_milestone_signoffs (
  id                 TEXT PRIMARY KEY,
  milestone_id       TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  approver_admin_id  TEXT NOT NULL,
  approver_role      TEXT NOT NULL,
  note               TEXT,
  signed_at          TEXT NOT NULL
);
