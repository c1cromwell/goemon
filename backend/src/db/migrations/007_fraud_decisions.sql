-- Stage 1 fraud seam (docs/business/FraudEngine-GapAnalysis.md §5).
--
-- Append-only record of every fraud-engine decision on a money-path event. This
-- is the prototype-scale analog of the FraudEngine.md "audit topic": each row is
-- a scored decision with its model version + reasons, immutable once written
-- (UPDATE/DELETE blocked by triggers in migrate.ts, like audit_logs).
--
-- Forward-compatible shape: event_id maps to a future Kafka key/offset; score is
-- stored as an integer 0..1000 (never float — honours the no-float discipline);
-- model_version starts at 'rules-v0' and becomes the Transformer version later.

CREATE TABLE IF NOT EXISTS fraud_decisions (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,                 -- risk_event id (future: stream key/offset)
  event_type      TEXT NOT NULL,                 -- transfer.send | ...
  channel         TEXT,                          -- api | smartchat | mcp | ...
  user_id         TEXT REFERENCES users(id),     -- the acting user
  counterparty_id TEXT,                          -- transfer recipient (nullable)
  amount_minor    INTEGER,                       -- integer minor units (nullable)
  currency        TEXT,
  score           INTEGER NOT NULL,              -- 0..1000 (risk score * 1000)
  action          TEXT NOT NULL,                 -- allow | flag | challenge | block
  reasons         TEXT NOT NULL DEFAULT '[]',    -- JSON array of {code, weight}
  model_version   TEXT NOT NULL,                 -- 'rules-v0'
  enforced        INTEGER NOT NULL DEFAULT 0,    -- 1 = action enforced (block threw)
  idempotency_key TEXT,                          -- links to the originating transfer
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fraud_decisions_user ON fraud_decisions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_decisions_action ON fraud_decisions(action, created_at);
