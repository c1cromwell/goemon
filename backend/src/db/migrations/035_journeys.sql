-- Journey orchestration platform (prototype) — journey-as-DATA.
--
-- journey_defs : versioned declarative journey definitions (a journey-builder UI
--                would write these; the runner reads them — no code deploy to change a flow)
-- journey_runs : a running instance, resumable (status + current_step + serialized context)
-- journey_steps: APPEND-ONLY per-run step trail (which step ran, control, diagnostic detail)
--
-- Decision-only prototype: runs produce a decision/outcome + Server-Driven-UI
-- descriptors; they do not move money or mutate identity (shadow-style adoption).

CREATE TABLE IF NOT EXISTS journey_defs (
  id           TEXT NOT NULL,
  version      TEXT NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | shadow | retired
  definition   TEXT NOT NULL,                    -- the JourneyDef JSON
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS journey_runs (
  id              TEXT PRIMARY KEY,
  journey_id      TEXT NOT NULL,
  version         TEXT NOT NULL,
  subject_user_id TEXT,
  status          TEXT NOT NULL,                 -- running | awaiting_input | awaiting_review | completed
  current_step    TEXT NOT NULL,
  context         TEXT NOT NULL,                 -- serialized JourneyContext
  outcome         TEXT,                          -- result string once completed
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journey_runs_subject ON journey_runs(subject_user_id, created_at);

-- Append-only step trail.
CREATE TABLE IF NOT EXISTS journey_steps (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  step_id    TEXT NOT NULL,
  step_type  TEXT NOT NULL,
  control    TEXT NOT NULL,                       -- continue | await | review | done
  detail     TEXT,                                -- JSON diagnostics (no PII beyond field keys)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journey_steps_run ON journey_steps(run_id, created_at);
