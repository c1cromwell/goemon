-- Phase 5A — Agentic account opening (risk-adaptive identity).
--
-- Adds the state for the AI-driven onboarding orchestrator:
--   * onboarding_sessions   — one risk-adaptive account-opening attempt per user
--   * onboarding_agent_runs — each orchestrator / sub-agent invocation in a session
--
-- These tables are MUTABLE state machines (status transitions, confidence updates),
-- so they are deliberately NOT in the append-only set. The immutable trail of every
-- decision lives in audit_logs (see auditService). All score columns are REAL — they
-- are confidence/risk scores in [0,1], never money (money is integer minor units).
--
-- The existing kyc_records and document_verifications tables are reused for the
-- sub-agent outputs; no new document/kyc tables are introduced.
--
-- The two ALTER statements are additive columns (same convention as 003); the file is
-- safe to apply once against a fresh database.

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  -- collecting | assessing | awaiting_verification | review_required | approved | rejected
  status          TEXT NOT NULL DEFAULT 'collecting',
  -- Per-signal sub-scores in [0,1] (1 = lowest risk / highest trust).
  email_score     REAL,
  ip_score        REAL,
  device_score    REAL,
  behavior_score  REAL,
  -- Fused PII-verification confidence in [0,1].
  pii_confidence  REAL,
  -- Opaque client-supplied device fingerprint hash (used for cross-user reuse detection).
  device_fingerprint TEXT,
  -- Minimized, PII-free signal summary handed to the orchestrator (JSON: scores + flags).
  signals_json    TEXT DEFAULT '{}',
  -- JSON array of step ids the orchestrator decided are required (e.g. ["document_validation"]).
  required_steps  TEXT DEFAULT '[]',
  -- auto_approve | step_up | manual_review | reject
  decision        TEXT,
  decided_tier      INTEGER,
  decided_risk_tier TEXT,
  -- simulated | anthropic — which orchestrator produced the assessment.
  orchestrator    TEXT DEFAULT 'simulated',
  rationale       TEXT,
  -- admin id who resolved a manual review (NULL until reviewed).
  reviewed_by     TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_agent_runs (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES onboarding_sessions(id),
  -- risk_orchestrator | document_validation | possession_check
  agent_type        TEXT NOT NULL,
  -- running | passed | failed
  status            TEXT NOT NULL DEFAULT 'running',
  -- PII-free JSON capturing what the agent saw / produced.
  input_json        TEXT DEFAULT '{}',
  output_json       TEXT DEFAULT '{}',
  confidence_before REAL,
  confidence_after  REAL,
  started_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at      TEXT
);

-- Isolates synthetic demo identities from real and seed users (admin filtering + protection).
ALTER TABLE users ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 0;

-- Links a profile to the onboarding session that most recently drove its tier.
ALTER TABLE identity_profiles ADD COLUMN onboarding_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_user ON onboarding_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status ON onboarding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_fp ON onboarding_sessions(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_onboarding_agent_runs_session ON onboarding_agent_runs(session_id);
