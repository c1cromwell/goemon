-- Phase 17 Stage 1 — Trading & brokerage (simulated, isolated seam).
--
-- A bounded trading domain (docs/PHASE-17-TRADING-BROKERAGE.md). Cash + positions
-- stay ledger-derived: each instrument's position is a ledger currency code
-- POS:<instrumentId> (the Phase-8 asset-as-currency pattern), so a settlement
-- journal balances per-currency AND per-instrument. These tables hold the trading
-- *domain* state (instruments, orders, fills) — never an authoritative cash ledger.
--
-- Money is integer minor units; quantities are integer base units (bigint). Never float.

CREATE TABLE IF NOT EXISTS instruments (
  id                TEXT PRIMARY KEY,
  symbol            TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL,                 -- equity | option | crypto
  display_name      TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',   -- cash settlement currency
  last_price_minor  INTEGER NOT NULL,              -- simulated mark (minor units / base unit)
  lot_size          INTEGER NOT NULL DEFAULT 1,    -- min order qty (base units)
  min_options_level INTEGER NOT NULL DEFAULT 0,    -- options-approval gate (0 = none)
  status            TEXT NOT NULL DEFAULT 'active',-- active | halted | delisted
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Per-user trading enrolment + approval levels (options/margin gates).
CREATE TABLE IF NOT EXISTS trading_accounts (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  options_level  INTEGER NOT NULL DEFAULT 0,
  margin_enabled INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Trading orders (distinct from the Phase-8 marketplace `orders` table).
CREATE TABLE IF NOT EXISTS orders_trading (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  instrument_id     TEXT NOT NULL REFERENCES instruments(id),
  side              TEXT NOT NULL,                 -- buy | sell
  type              TEXT NOT NULL,                 -- market | limit
  qty_base          INTEGER NOT NULL,              -- integer base units
  limit_price_minor INTEGER,                       -- null for market orders
  status            TEXT NOT NULL DEFAULT 'accepted', -- accepted | settled | rejected | canceled
  reject_reason     TEXT,
  broker_order_id   TEXT,
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Immutable execution records (append-only, like ledger_entries). A fill is only
-- written once its settlement journal is posted; settled_journal_id links the two.
CREATE TABLE IF NOT EXISTS fills (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders_trading(id),
  qty_base           INTEGER NOT NULL,
  price_minor        INTEGER NOT NULL,             -- executed price per base unit
  fee_minor          INTEGER NOT NULL DEFAULT 0,
  gross_minor        INTEGER NOT NULL,             -- qty * price
  settled_journal_id TEXT NOT NULL,                -- the balanced ledger journal
  created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_trading_user ON orders_trading(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_trading_status ON orders_trading(status);
CREATE INDEX IF NOT EXISTS idx_fills_order ON fills(order_id);

-- Demo instruments (deterministic simulated marks). Equities + crypto + one option.
INSERT INTO instruments (id, symbol, kind, display_name, currency, last_price_minor, lot_size, min_options_level)
VALUES
  ('inst-aapl', 'AAPL', 'equity', 'Apple Inc.',        'USD',    19000, 1, 0),
  ('inst-msft', 'MSFT', 'equity', 'Microsoft Corp.',   'USD',    42000, 1, 0),
  ('inst-btc',  'BTC',  'crypto', 'Bitcoin',           'USD',  6500000, 1, 0),
  ('inst-eth',  'ETH',  'crypto', 'Ethereum',          'USD',   350000, 1, 0),
  ('inst-aapl-c', 'AAPL-C-200', 'option', 'AAPL $200 Call', 'USD', 500, 1, 1)
ON CONFLICT (symbol) DO NOTHING;
