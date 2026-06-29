-- Goemon Global Finance initial schema (v2). Portable across SQLite (dev) and Postgres (prod).
-- Conventions:
--   * Money is INTEGER minor units in columns named *_minor, paired with a currency column.
--   * Booleans are INTEGER 0/1.
--   * Timestamps are TEXT ISO-8601 UTC with DEFAULT CURRENT_TIMESTAMP.
--   * All tables use IF NOT EXISTS so this script is safe to re-run.
-- Append-only triggers for audit/ledger tables are applied separately (dialect-specific) by migrate.ts.

-- ---- Users & accounts ----------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,                       -- nullable: passkey users have no password
  full_name     TEXT,
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  account_number TEXT UNIQUE,
  account_type   TEXT DEFAULT 'checking',
  balance_minor  INTEGER NOT NULL DEFAULT 1000000,   -- $10,000.00
  currency       TEXT DEFAULT 'USD',
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS savings_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  account_number    TEXT UNIQUE,
  account_type      TEXT DEFAULT 'savings',
  balance_minor     INTEGER NOT NULL DEFAULT 500000,  -- $5,000.00
  currency          TEXT DEFAULT 'USD',
  interest_rate_bps INTEGER DEFAULT 250,              -- 2.50% as basis points
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  journal_id      TEXT,                               -- links to the ledger journal (v2)
  from_account_id TEXT,
  to_account_id   TEXT,
  to_external     TEXT,
  amount_minor    INTEGER NOT NULL,
  currency        TEXT DEFAULT 'USD',
  description     TEXT DEFAULT '',
  type            TEXT,
  status          TEXT DEFAULT 'completed',
  agent_id        TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Internal agents (v1) ------------------------------------------------

CREATE TABLE IF NOT EXISTS agents (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id),
  name                 TEXT,
  description          TEXT DEFAULT '',
  type                 TEXT,
  permissions          TEXT,                          -- JSON array
  transfer_limit_minor INTEGER DEFAULT 50000,         -- $500.00
  currency             TEXT DEFAULT 'USD',
  mfa_verified         INTEGER DEFAULT 0,
  status               TEXT DEFAULT 'active',
  expires_at           TEXT,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  role       TEXT,
  content    TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  agent_id   TEXT,
  code       TEXT,
  purpose    TEXT DEFAULT 'transfer',
  expires_at TEXT,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operation_tokens (
  id            TEXT PRIMARY KEY,
  token         TEXT UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  operation     TEXT,
  scope         TEXT,
  status        TEXT DEFAULT 'pending',
  mfa_required  INTEGER DEFAULT 0,
  mfa_verified  INTEGER DEFAULT 0,
  metadata      TEXT DEFAULT '{}',
  result        TEXT,
  lifetime_secs INTEGER DEFAULT 90,
  agent_id      TEXT,
  expires_at    TEXT,
  used_at       TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Audit (append-only) -------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  agent_id   TEXT,
  agent_name TEXT,
  action     TEXT,
  resource   TEXT DEFAULT '',
  details    TEXT DEFAULT '{}',
  status     TEXT DEFAULT 'success',
  ip_address TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Identity & KYC ------------------------------------------------------

CREATE TABLE IF NOT EXISTS identity_profiles (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL UNIQUE REFERENCES users(id),
  identity_status TEXT DEFAULT 'pending',
  tier            INTEGER DEFAULT 0,                  -- v2 tiered ladder (0..4)
  risk_tier       TEXT DEFAULT 'unknown',
  kyc_reference   TEXT,
  sanctions_clear INTEGER,
  initiated_at    TEXT,
  completed_at    TEXT,
  reviewed_at     TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_verifications (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  profile_id       TEXT NOT NULL REFERENCES identity_profiles(id),
  document_type    TEXT,
  issuing_country  TEXT DEFAULT 'US',
  document_number  TEXT,
  full_name        TEXT,
  date_of_birth    TEXT,
  expiry_date      TEXT,
  address          TEXT,
  provider         TEXT DEFAULT 'simulated',
  provider_ref     TEXT,
  status           TEXT DEFAULT 'pending',
  confidence_score REAL,                              -- a score (0..1), NOT money — REAL is fine here
  raw_response     TEXT DEFAULT '{}',
  attempt_number   INTEGER DEFAULT 1,
  agent_id         TEXT,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kyc_records (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  profile_id       TEXT NOT NULL REFERENCES identity_profiles(id),
  provider         TEXT DEFAULT 'simulated',
  provider_ref     TEXT,
  status           TEXT DEFAULT 'pending',
  sanctions_result TEXT DEFAULT 'pending',
  pep_result       TEXT DEFAULT 'pending',
  risk_score       REAL,                              -- score, not money
  risk_tier        TEXT,
  checked_name     TEXT,
  checked_dob      TEXT,
  notes            TEXT,
  raw_response     TEXT DEFAULT '{}',
  agent_id         TEXT,
  created_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS id_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT REFERENCES identity_profiles(id),
  agent_id   TEXT,
  event_type TEXT,
  payload    TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Verifiable credentials ---------------------------------------------

CREATE TABLE IF NOT EXISTS credentials (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE REFERENCES users(id),
  vc_jwt       TEXT,
  did_subject  TEXT,
  status_index INTEGER,
  allowed_ops  TEXT DEFAULT '["balance:read","transfer:low","statement:read","profile:read"]',
  revoked      INTEGER DEFAULT 0,
  revoke_reason TEXT,
  issued_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at   TEXT
);

CREATE TABLE IF NOT EXISTS credential_status_lists (
  id            TEXT PRIMARY KEY,
  list_year     INTEGER UNIQUE,
  next_index    INTEGER DEFAULT 0,
  encoded_list  TEXT,                                  -- base64 gzip bitstring (v2 BitstringStatusList)
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- MCP / external agents ----------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_clients (
  id                   TEXT PRIMARY KEY,
  client_did           TEXT UNIQUE,
  display_name         TEXT,
  description          TEXT DEFAULT '',
  allowed_functions    TEXT DEFAULT '[]',
  max_transfer_minor   INTEGER DEFAULT 0,
  currency             TEXT DEFAULT 'USD',
  require_user_approval INTEGER DEFAULT 1,
  active               INTEGER DEFAULT 1,
  registered_by        TEXT,
  registered_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  suspended_at         TEXT,
  suspended_reason     TEXT
);

CREATE TABLE IF NOT EXISTS presentation_nonces (
  nonce      TEXT PRIMARY KEY,
  client_did TEXT,
  scope      TEXT DEFAULT '[]',
  expires_at TEXT,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vp_presentations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  client_did   TEXT,
  vp_hash      TEXT,
  nonce        TEXT,
  scope_issued TEXT,
  token_jti    TEXT,
  ip_address   TEXT DEFAULT '',
  presented_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_tokens (
  nonce      TEXT PRIMARY KEY,
  token      TEXT,
  scope      TEXT,
  expires_in INTEGER DEFAULT 90,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_agent_grants (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  agent_did          TEXT,
  display_name       TEXT,
  description        TEXT DEFAULT '',
  allowed_functions  TEXT DEFAULT '[]',
  max_transfer_minor INTEGER DEFAULT 50000,
  currency           TEXT DEFAULT 'USD',
  active             INTEGER DEFAULT 1,
  granted_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used_at       TEXT,
  revoked_at         TEXT,
  revoke_reason      TEXT,
  UNIQUE(user_id, agent_did)
);

CREATE TABLE IF NOT EXISTS mcp_audit_logs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES users(id),
  agent_did         TEXT,
  agent_type        TEXT DEFAULT 'external',
  internal_agent_id TEXT,
  tool_name         TEXT,
  scope_used        TEXT,
  args              TEXT DEFAULT '{}',
  result_status     TEXT DEFAULT 'success',
  error_message     TEXT,
  token_jti         TEXT,
  ip_address        TEXT DEFAULT '',
  duration_ms       INTEGER,
  called_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- v2 additions: auth, ledger, hedera, idempotency --------------------

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response     TEXT,
  http_status  INTEGER,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key, user_id)
);

CREATE TABLE IF NOT EXISTS passkeys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT UNIQUE,
  public_key    TEXT,
  counter       INTEGER DEFAULT 0,
  transports    TEXT,
  device_name   TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used_at  TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  challenge  TEXT,
  purpose    TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_failures (
  id         TEXT PRIMARY KEY,
  identifier TEXT,                                     -- email / user id attempted
  ip         TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Double-entry ledger (v2). ledger_entries and ledger_journals are append-only.

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                                     -- null for system accounts (fee, clearing)
  kind       TEXT NOT NULL,                            -- user_cash | user_savings | bank_settlement | fee | escrow | external_clearing
  currency   TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger_journals (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  description     TEXT,
  external_ref    TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                TEXT PRIMARY KEY,
  journal_id        TEXT NOT NULL REFERENCES ledger_journals(id),
  ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
  direction         TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hedera_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL UNIQUE REFERENCES users(id),
  hedera_account_id TEXT UNIQUE,
  evm_address       TEXT,
  public_key        TEXT,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Admin / RBAC (used in later phases) --------------------------------

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,
  role          TEXT DEFAULT 'admin',                  -- user | support | compliance | admin
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---- Indexes -------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(ledger_account_id);
CREATE INDEX IF NOT EXISTS idx_auth_failures_id ON auth_failures(identifier, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_user ON mcp_audit_logs(user_id, agent_did);
