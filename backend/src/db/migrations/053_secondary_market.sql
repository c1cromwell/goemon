-- Phase 29 P6 — secondary market (peer-to-peer limit order book).
--
-- Makers rest orders (units escrowed for sells, cash escrowed for buys); a taker crosses the
-- book and fills at the resting (maker) price with price-time priority. Zero rail fee (the
-- Goemon wedge). Money columns are integer minor units as TEXT (bigint). Orders are mutable
-- (qty_remaining, status); trades are immutable fills. Ties to docs/TOKENIZATION-MASTER-PLAN.md (P6).

CREATE TABLE IF NOT EXISTS trade_orders (
  id                TEXT PRIMARY KEY,
  asset_id          TEXT NOT NULL REFERENCES assets(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  side              TEXT NOT NULL,                 -- buy | sell
  qty_total         TEXT NOT NULL,                 -- bigint
  qty_remaining     TEXT NOT NULL,                 -- bigint
  limit_price_minor TEXT NOT NULL,                 -- bigint: per-unit limit
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'open',  -- open | filled | cancelled
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_orders_book ON trade_orders(asset_id, side, status);
CREATE INDEX IF NOT EXISTS idx_trade_orders_user ON trade_orders(user_id);

CREATE TABLE IF NOT EXISTS trades (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL REFERENCES assets(id),
  buy_order_id     TEXT NOT NULL REFERENCES trade_orders(id),
  sell_order_id    TEXT NOT NULL REFERENCES trade_orders(id),
  buyer_user_id    TEXT NOT NULL REFERENCES users(id),
  seller_user_id   TEXT NOT NULL REFERENCES users(id),
  qty              TEXT NOT NULL,                  -- bigint
  price_minor      TEXT NOT NULL,                  -- bigint: execution price / unit
  currency         TEXT NOT NULL DEFAULT 'USD',
  journal_id       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_user_id);
