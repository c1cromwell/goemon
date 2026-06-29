-- Phase 24 — verifiable intents (x401 intent binding) + production readiness audit log.

CREATE TABLE IF NOT EXISTS verifiable_intents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  intent_hash     TEXT NOT NULL,
  vp_hash         TEXT,
  scope_json      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verifiable_intents_user ON verifiable_intents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS production_readiness_snapshots (
  id              TEXT PRIMARY KEY,
  workstream      TEXT NOT NULL,
  status          TEXT NOT NULL,
  details_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
