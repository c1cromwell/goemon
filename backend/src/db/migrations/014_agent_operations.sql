-- Phase 15.0 — Internal agent operations (the back-office runner).
--
-- Generalizes onboarding_agent_runs (migration 004) into a skill-agnostic trail:
--   * agent_runs    — APPEND-ONLY record of every workflow run (the immutable trail
--                     of "agent recommended X; deterministic gate did Y"). Blocked
--                     for UPDATE/DELETE by trigger (see migrate.ts), like audit_logs.
--   * agent_reviews — the human-review queue. A MUTABLE state machine (pending →
--                     approved|rejected as a human decides at the gate), so it is
--                     deliberately NOT append-only — the immutable decision trail
--                     still lives in agent_runs + audit_logs.
--
-- INVARIANT: agents only recommend; a deterministic, RBAC-checked, audited gate is
-- the only thing that executes (see operations/operationsWorkflow.ts). No money or
-- account/credential mutation is ever an exposed agent capability.
-- confidence is a model score in [0,1] (REAL), never money.

CREATE TABLE IF NOT EXISTS agent_runs (
  id             TEXT PRIMARY KEY,
  skill          TEXT NOT NULL,
  skill_version  TEXT NOT NULL,
  workflow_run   TEXT NOT NULL,            -- correlates the steps/decision of one run
  supervision    TEXT NOT NULL,            -- auto_approve|auto_approve_audit|human_required|human_led
  tool_calls     TEXT NOT NULL DEFAULT '[]',  -- JSON: scoped tool invocations (no raw PII/args)
  recommendation TEXT NOT NULL DEFAULT '{}',  -- JSON: structured agent output
  gate_decision  TEXT NOT NULL DEFAULT '{}',  -- JSON: approve|reject|escalate + reason
  actor_admin_id TEXT,                      -- the human at the gate, when applicable
  outcome        TEXT NOT NULL,            -- executed|queued|rejected|error
  confidence     REAL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_skill    ON agent_runs(skill);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow ON agent_runs(workflow_run);

CREATE TABLE IF NOT EXISTS agent_reviews (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL,
  workflow_run    TEXT NOT NULL,
  skill           TEXT NOT NULL,
  subject_user_id TEXT,                     -- the user the decision is about, when applicable
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  requires_role   TEXT NOT NULL DEFAULT 'compliance', -- comma-separated allow-list for the gate
  recommendation  TEXT NOT NULL DEFAULT '{}',  -- JSON: advisory output shown to the human
  reason          TEXT,                     -- why this escalated
  decided_by      TEXT,                     -- admin id who resolved it
  decision_reason TEXT,
  created_at      TEXT NOT NULL,
  decided_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_reviews_status ON agent_reviews(status);
