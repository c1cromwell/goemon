-- Goeman Fraud Engine — schema.
--
-- Layer map (see docs/business/FraudEngine.md):
--   events        → the unified event stream (Kafka topic analog), immutable
--   user_features → Flink per-user state + online feature store (mutable)
--   models        → model registry (MLflow analog)
--   routing_config→ the fraud-team's config-driven router
--   decisions     → the scored-decision "audit topic" (APPEND-ONLY)
--   labels        → outcome feedback for the lakehouse/retrain loop
--   cases         → analyst alert/case queue (mutable state machine)
--   case_events   → immutable case audit trail (APPEND-ONLY)

-- Raw ingested events. Immutable; the stream's source of truth.
CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  schema_version  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  mode            TEXT NOT NULL,              -- score (sync) | async
  user_id         TEXT NOT NULL,
  counterparty_id TEXT,
  channel         TEXT,
  amount_minor    INTEGER,                    -- money is integer minor units
  currency        TEXT,
  device_id       TEXT,
  ip              TEXT,
  geo             TEXT,
  idempotency_key TEXT,
  payload         TEXT NOT NULL,              -- full normalized JSON
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);

-- Per-user feature state (the "online store"). Mutable; updated as events flow.
CREATE TABLE IF NOT EXISTS user_features (
  user_id              TEXT PRIMARY KEY,
  event_count          INTEGER NOT NULL DEFAULT 0,
  transfer_out_count   INTEGER NOT NULL DEFAULT 0,
  trailing_max_minor   INTEGER NOT NULL DEFAULT 0,
  total_out_minor      INTEGER NOT NULL DEFAULT 0,
  distinct_payees      TEXT NOT NULL DEFAULT '[]',  -- JSON array of counterparty ids
  recent_event_ts      TEXT NOT NULL DEFAULT '[]',  -- JSON array of ISO timestamps (velocity window)
  recent_amounts_minor TEXT NOT NULL DEFAULT '[]',  -- JSON array of recent amounts (sequence model input)
  last_geo             TEXT,
  last_device_id       TEXT,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Model registry. status ∈ prod | shadow | canary | retired.
CREATE TABLE IF NOT EXISTS models (
  version      TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                 -- rules | sequence
  status       TEXT NOT NULL DEFAULT 'shadow',
  canary_pct   INTEGER NOT NULL DEFAULT 0,    -- 0..100, only meaningful when status=canary
  cohort_expr  TEXT,                          -- optional CEL predicate; canary active only when it evals true
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CEL rule sets — rules-as-DATA. Each row is a {code, CEL expr, weight} the
-- CelRulesModel evaluates. Analysts add/tune rules here; a new set is promoted via
-- the model registry (shadow → canary → prod), no redeploy. Append-friendly.
CREATE TABLE IF NOT EXISTS rules (
  id           TEXT PRIMARY KEY,
  rule_set     TEXT NOT NULL,                 -- the model version this rule belongs to (e.g. rules-cel-v1)
  code         TEXT NOT NULL,                 -- the Reason code emitted when it fires
  expr         TEXT NOT NULL,                 -- CEL (subset) predicate over the event activation
  weight       INTEGER NOT NULL,             -- contribution in milli-units (weight*1000), integer (no floats)
  enabled      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rules_set ON rules(rule_set, enabled);

-- CEL action policy — the decision ladder (block/challenge/flag/freeze) as DATA.
-- Highest-priority matching expr wins; falls back to the routing_config thresholds.
CREATE TABLE IF NOT EXISTS action_policy (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,                 -- allow | flag | challenge | block | freeze
  expr         TEXT NOT NULL,                 -- CEL over {score, mode, amountMinor, reasonCodes}
  priority     INTEGER NOT NULL DEFAULT 0,    -- higher wins
  enabled      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Config-driven router knobs (single-row, id='default').
CREATE TABLE IF NOT EXISTS routing_config (
  id             TEXT PRIMARY KEY,
  block_at       INTEGER NOT NULL DEFAULT 800,   -- thresholds in milli-units (score*1000)
  challenge_at   INTEGER NOT NULL DEFAULT 500,
  flag_at        INTEGER NOT NULL DEFAULT 250,
  freeze_at      INTEGER NOT NULL DEFAULT 900,   -- async decisions at/above this auto-remediate
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Scored decisions. APPEND-ONLY (the immutable "audit topic").
CREATE TABLE IF NOT EXISTS decisions (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  mode          TEXT NOT NULL,
  score         INTEGER NOT NULL,             -- milli-units (0..1000)
  action        TEXT NOT NULL,                -- allow | flag | challenge | block | freeze
  reasons       TEXT NOT NULL,                -- JSON [{code,weight}]
  explanation   TEXT NOT NULL,                -- JSON [{feature,contribution}] (SHAP-like)
  model_version TEXT NOT NULL,
  shadow_json   TEXT,                         -- JSON [{modelVersion,score,action}] for shadow/canary runs
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user_id, created_at);

-- Outcome labels for the retrain/drift loop.
CREATE TABLE IF NOT EXISTS labels (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  decision_id TEXT,
  label       TEXT NOT NULL,                  -- confirmed_fraud | legit | chargeback
  source      TEXT,                           -- analyst | partner | system
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Analyst case/alert queue. Mutable state machine.
CREATE TABLE IF NOT EXISTS cases (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  decision_id  TEXT,
  severity     TEXT NOT NULL,                 -- low | medium | high | critical
  status       TEXT NOT NULL DEFAULT 'open',  -- open | assigned | resolved | dismissed
  assignee     TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status, created_at);

-- Immutable case audit trail. APPEND-ONLY.
CREATE TABLE IF NOT EXISTS case_events (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL,
  action     TEXT NOT NULL,                   -- opened | assigned | freeze_requested | flag_requested | resolved | dismissed
  actor      TEXT NOT NULL,                   -- system | analyst id
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
