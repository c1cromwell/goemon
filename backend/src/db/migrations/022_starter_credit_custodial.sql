-- Phase 22.4–22.5 — credit-builder card + custodial investing (prototype seams).

CREATE TABLE IF NOT EXISTS credit_builder_accounts (
  id                     TEXT PRIMARY KEY,
  teen_user_id           TEXT NOT NULL UNIQUE REFERENCES users(id),
  guardian_user_id       TEXT NOT NULL REFERENCES users(id),
  card_id                TEXT REFERENCES cards(id),
  secured_limit_minor    TEXT NOT NULL DEFAULT '0',
  statement_balance_minor TEXT NOT NULL DEFAULT '0',
  status                 TEXT NOT NULL DEFAULT 'active',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_builder_statements (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES credit_builder_accounts(id),
  period          TEXT NOT NULL,
  opening_minor   TEXT NOT NULL DEFAULT '0',
  charges_minor   TEXT NOT NULL DEFAULT '0',
  payments_minor  TEXT NOT NULL DEFAULT '0',
  closing_minor   TEXT NOT NULL DEFAULT '0',
  paid_on_time    INTEGER NOT NULL DEFAULT 0,
  utilization_bps INTEGER NOT NULL DEFAULT 0,
  bureau_report_id TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TEXT NOT NULL,
  UNIQUE(account_id, period)
);

CREATE TABLE IF NOT EXISTS credit_bureau_reports (
  id               TEXT PRIMARY KEY,
  teen_user_id     TEXT NOT NULL REFERENCES users(id),
  guardian_user_id TEXT NOT NULL REFERENCES users(id),
  statement_id     TEXT REFERENCES credit_builder_statements(id),
  provider         TEXT NOT NULL DEFAULT 'simulated',
  external_ref     TEXT,
  status           TEXT NOT NULL DEFAULT 'submitted',
  payload          TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custodial_accounts (
  id               TEXT PRIMARY KEY,
  teen_user_id     TEXT NOT NULL UNIQUE REFERENCES users(id),
  guardian_user_id TEXT NOT NULL REFERENCES users(id),
  account_type     TEXT NOT NULL DEFAULT 'ugma',
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custodial_orders (
  id                   TEXT PRIMARY KEY,
  custodial_account_id TEXT NOT NULL REFERENCES custodial_accounts(id),
  teen_user_id         TEXT NOT NULL REFERENCES users(id),
  guardian_user_id     TEXT NOT NULL REFERENCES users(id),
  asset_id             TEXT NOT NULL,
  side                 TEXT NOT NULL,
  qty_base             TEXT NOT NULL,
  review_id            TEXT REFERENCES agent_reviews(id),
  marketplace_order_id TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  idempotency_key      TEXT UNIQUE,
  created_at           TEXT NOT NULL,
  decided_at           TEXT,
  settled_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_custodial_orders_teen ON custodial_orders(teen_user_id);
