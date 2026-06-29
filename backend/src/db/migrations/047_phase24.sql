-- Phase 24 — x401 verification tokens + borderless savings enrollments.

CREATE TABLE IF NOT EXISTS x401_verification_tokens (
  id                TEXT PRIMARY KEY,
  token_hash        TEXT NOT NULL UNIQUE,
  user_id           TEXT NOT NULL,
  client_did        TEXT NOT NULL,
  scope_json        TEXT NOT NULL,
  jti               TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  consumed          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_x401_tokens_user ON x401_verification_tokens(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS savings_product_enrollments (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  currency          TEXT NOT NULL DEFAULT 'USDC',
  apy_bps           INTEGER NOT NULL DEFAULT 350,
  enrolled_at       TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
