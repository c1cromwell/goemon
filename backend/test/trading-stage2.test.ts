/**
 * Phase 17 Stage 2 — limit/stop/options/crypto + market-data seam.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-trading-s2-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { TRADING_ENABLED: boolean }).TRADING_ENABLED = true;
}

describe("Phase 17 Stage 2: trading + market data", () => {
  let trader: string;

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const u = await createUser(`trader-s2-${Date.now()}@trade.test`, "Trader S2");
    trader = u.id;
    await getOrCreateUserAccount(u.id, "user_cash", "USD");
  });

  it("market-data quote includes source, asOf, and staleness flag", async () => {
    const { getQuotes } = await import("../src/services/marketDataService");
    const quotes = await getQuotes(["AAPL"]);
    expect(quotes.length).toBe(1);
    expect(quotes[0]!.source).toBe("simulated");
    expect(quotes[0]!.asOf).toBeTruthy();
    expect(quotes[0]!.stale).toBe(false);
    expect(quotes[0]!.bidMinor).toBe(18_999n);
    expect(quotes[0]!.askMinor).toBe(19_001n);
    expect(quotes[0]!.lastMinor).toBe(19_000n);
  });

  it("limit buy below market stays pending until price drops", async () => {
    const { placeOrder, runSettlementOnce } = await import("../src/services/tradingService");
    const { getDb } = await import("../src/db");
    const { __resetBroker } = await import("../src/services/tradingBroker");
    __resetBroker();

    const order = await placeOrder({
      userId: trader,
      symbol: "AAPL",
      side: "buy",
      type: "limit",
      qtyBase: 1n,
      limitPriceMinor: 18_000n,
      idempotencyKey: `lim-pend-${Date.now()}`,
    });
    await runSettlementOnce();

    let row = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(row?.status).toBe("accepted");

    await getDb().execute("UPDATE instruments SET last_price_minor = ? WHERE symbol = 'AAPL'", [17_500]);
    await runSettlementOnce();

    row = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(row?.status).toBe("settled");
  });

  it("stop buy stays pending until stop price is crossed", async () => {
    const { placeOrder, runSettlementOnce } = await import("../src/services/tradingService");
    const { getDb } = await import("../src/db");
    const { __resetBroker } = await import("../src/services/tradingBroker");
    __resetBroker();

    await getDb().execute("UPDATE instruments SET last_price_minor = ? WHERE symbol = 'MSFT'", [42_000]);

    const order = await placeOrder({
      userId: trader,
      symbol: "MSFT",
      side: "buy",
      type: "stop",
      qtyBase: 1n,
      stopPriceMinor: 43_000n,
      idempotencyKey: `stop-pend-${Date.now()}`,
    });
    await runSettlementOnce();

    let row = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(row?.status).toBe("accepted");

    await getDb().execute("UPDATE instruments SET last_price_minor = ? WHERE symbol = 'MSFT'", [43_500]);
    await runSettlementOnce();

    row = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(row?.status).toBe("settled");
  });

  it("options require approval level; admin can raise it", async () => {
    const { placeOrder } = await import("../src/services/tradingService");
    const { setOptionsLevel } = await import("../src/services/tradingService");
    const { ErrorCode } = await import("../src/errors");

    await expect(
      placeOrder({
        userId: trader,
        symbol: "AAPL-C-200",
        side: "buy",
        type: "market",
        qtyBase: 1n,
        idempotencyKey: `opt-deny-${Date.now()}`,
      })
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    await setOptionsLevel(trader, 1);

    const order = await placeOrder({
      userId: trader,
      symbol: "AAPL-C-200",
      side: "buy",
      type: "market",
      qtyBase: 1n,
      idempotencyKey: `opt-ok-${Date.now()}`,
    });
    expect(order.status).toBe("accepted");
  });

  it("crypto spot buy settles through the same ledger seam", async () => {
    const { placeOrder, runSettlementOnce, getPositions } = await import("../src/services/tradingService");
    const { __resetBroker } = await import("../src/services/tradingBroker");
    __resetBroker();

    const order = await placeOrder({
      userId: trader,
      symbol: "ETH",
      side: "buy",
      type: "market",
      qtyBase: 1n,
      idempotencyKey: `eth-${Date.now()}`,
    });
    await runSettlementOnce();

    const { getDb } = await import("../src/db");
    const row = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(row?.status).toBe("settled");
    const positions = await getPositions(trader);
    expect(positions.find((p) => p.symbol === "ETH")?.qtyBase).toBe("1");
  });

  it("market_data_snapshots are append-only", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE market_data_snapshots SET last_minor = 0 WHERE instrument_id = 'inst-aapl'")
    ).rejects.toThrow(/append-only/i);
  });
});
