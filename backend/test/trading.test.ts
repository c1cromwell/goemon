/**
 * Phase 17 Stage 1 — Trading seam tests (docs/PHASE-17-TRADING-BROKERAGE.md §9).
 *
 * Verifies the SLA-isolation architecture:
 *   1. TRADING_ENABLED is a kill-switch (off ⇒ TRADING_DISABLED; bank unaffected).
 *   2. A buy settles into a balanced ledger journal (cash down, position up).
 *   3. Settlement is exactly-once (idempotent on the fill key).
 *   4. A sell reduces the position and credits cash.
 *   5. Insufficient funds ⇒ order rejected, NOT a money error; no journal.
 *   6. SLA ISOLATION: a stalled broker does NOT block a concurrent transfer;
 *      a failing broker leaves the order pending + opens the circuit breaker while
 *      the money path keeps working; recovery settles the order.
 *   7. fills are append-only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-trading-${Date.now()}.db`;

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
  (config as { TRADING_ENABLED: boolean }).TRADING_ENABLED = true; // enable the seam for tests
}

describe("Phase 17 Stage 1: trading seam", () => {
  let trader: string;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    for (const [email, name] of [
      ["trader@trade.test", "Trader"],
      ["alice@trade.test", "Alice"],
      ["bob@trade.test", "Bob"],
    ] as const) {
      const u = await createUser(email, name);
      await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
      if (email.startsWith("trader")) trader = u.id;
      if (email.startsWith("alice")) alice = u.id;
      if (email.startsWith("bob")) bob = u.id;
    }
  });

  it("kill-switch: TRADING_ENABLED=false ⇒ placeOrder throws TRADING_DISABLED", async () => {
    const { config } = await import("../src/config");
    const { placeOrder } = await import("../src/services/tradingService");
    const { ErrorCode } = await import("../src/errors");
    (config as { TRADING_ENABLED: boolean }).TRADING_ENABLED = false;
    try {
      await expect(
        placeOrder({ userId: trader, symbol: "AAPL", side: "buy", type: "market", qtyBase: 1n, idempotencyKey: "ks-1" })
      ).rejects.toMatchObject({ code: ErrorCode.TRADING_DISABLED });
    } finally {
      (config as { TRADING_ENABLED: boolean }).TRADING_ENABLED = true;
    }
  });

  it("buy settles into a balanced journal: cash down, position up", async () => {
    const { placeOrder, runSettlementOnce, getPositions } = await import("../src/services/tradingService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const { __resetBroker } = await import("../src/services/tradingBroker");
    __resetBroker();

    const cashAcct = await getOrCreateUserAccount(trader, "user_cash", "USD");
    const before = await getBalance(cashAcct);

    const order = await placeOrder({ userId: trader, symbol: "AAPL", side: "buy", type: "market", qtyBase: 1n, idempotencyKey: "buy-1" });
    expect(order.status).toBe("accepted"); // HOT PATH: accepted, not yet settled

    await runSettlementOnce();

    const after = await getBalance(cashAcct);
    expect(before - after).toBe(19_019n); // $190.00 + $0.19 fee (10bps)
    const positions = await getPositions(trader);
    expect(positions.find((p) => p.symbol === "AAPL")?.qtyBase).toBe("1");

    const { getDb } = await import("../src/db");
    const o = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(o?.status).toBe("settled");
  });

  it("settlement is exactly-once (idempotent on the fill key)", async () => {
    const { settleOrder } = await import("../src/services/tradingService");
    const { getDb } = await import("../src/db");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const order = await getDb().queryOne<{ id: string }>("SELECT id FROM orders_trading WHERE idempotency_key = 'buy-1'");
    const cashAcct = await getOrCreateUserAccount(trader, "user_cash", "USD");
    const before = await getBalance(cashAcct);

    await settleOrder(order!.id); // re-settle an already-settled order
    await settleOrder(order!.id);

    const after = await getBalance(cashAcct);
    expect(after).toBe(before); // no double-debit
    const fills = await getDb().query("SELECT id FROM fills WHERE order_id = ?", [order!.id]);
    expect(fills.length).toBe(1); // exactly one fill
  });

  it("sell reduces the position and credits cash", async () => {
    const { placeOrder, runSettlementOnce, getPositions } = await import("../src/services/tradingService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const cashAcct = await getOrCreateUserAccount(trader, "user_cash", "USD");
    const before = await getBalance(cashAcct);

    await placeOrder({ userId: trader, symbol: "AAPL", side: "sell", type: "market", qtyBase: 1n, idempotencyKey: "sell-1" });
    await runSettlementOnce();

    const after = await getBalance(cashAcct);
    expect(after - before).toBe(18_981n); // $190.00 - $0.19 fee
    const positions = await getPositions(trader);
    expect(positions.find((p) => p.symbol === "AAPL")).toBeUndefined(); // flat
  });

  it("insufficient funds ⇒ order rejected, not a money error, no journal", async () => {
    const { placeOrder, runSettlementOnce } = await import("../src/services/tradingService");
    const { getDb } = await import("../src/db");

    // 100 BTC ≈ $650,000 — far over the $10k balance.
    const order = await placeOrder({ userId: trader, symbol: "BTC", side: "buy", type: "market", qtyBase: 100n, idempotencyKey: "over-1" });
    await runSettlementOnce();

    const o = await getDb().queryOne<{ status: string; reject_reason: string }>(
      "SELECT status, reject_reason FROM orders_trading WHERE id = ?",
      [order.id]
    );
    expect(o?.status).toBe("rejected");
    expect(o?.reject_reason).toBe("insufficient_funds");
    const fills = await getDb().query("SELECT id FROM fills WHERE order_id = ?", [order.id]);
    expect(fills.length).toBe(0);
  });

  it("SLA ISOLATION: a stalled broker does not block a concurrent transfer", async () => {
    const { placeOrder, runSettlementOnce } = await import("../src/services/tradingService");
    const { transfer } = await import("../src/services/transferService");
    const { __setBrokerMode, __resetBroker } = await import("../src/services/tradingBroker");

    __setBrokerMode("stall", { stallMs: 400 }); // broker takes 400ms to respond

    await placeOrder({ userId: trader, symbol: "MSFT", side: "buy", type: "market", qtyBase: 1n, idempotencyKey: "iso-1" });
    const settlePromise = runSettlementOnce(); // in flight, awaiting the 400ms broker

    // The money path must NOT wait on the stalled broker.
    const t0 = Date.now();
    const result = await transfer({
      fromUserId: alice,
      toUserId: bob,
      amountMinor: 5_000n,
      currency: "USD",
      idempotencyKey: "iso-transfer-1",
    });
    const elapsed = Date.now() - t0;

    expect(result.journalId).toBeTruthy(); // transfer succeeded
    expect(elapsed).toBeLessThan(350); // returned before the 400ms broker stall — not blocked

    await settlePromise; // broker eventually responds; order settles
    __resetBroker();
  });

  it("SLA ISOLATION: a failing broker leaves the order pending + opens the breaker; money path unaffected", async () => {
    const { placeOrder, runSettlementOnce, settleOrder } = await import("../src/services/tradingService");
    const { transfer } = await import("../src/services/transferService");
    const { getDb } = await import("../src/db");
    const { __setBrokerMode, __resetBroker, breakerOpen } = await import("../src/services/tradingBroker");

    __resetBroker();
    __setBrokerMode("fail");

    const order = await placeOrder({ userId: trader, symbol: "ETH", side: "buy", type: "market", qtyBase: 1n, idempotencyKey: "fail-1" });

    // Drive enough failures to trip the breaker (threshold 3).
    await settleOrder(order.id);
    await settleOrder(order.id);
    await settleOrder(order.id);

    const pending = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(pending?.status).toBe("accepted"); // never settled while broker is down
    expect(breakerOpen()).toBe(true); // circuit fast-fails further calls

    // Money path still works during the trading outage.
    const result = await transfer({
      fromUserId: alice,
      toUserId: bob,
      amountMinor: 1_000n,
      currency: "USD",
      idempotencyKey: "fail-transfer-1",
    });
    expect(result.journalId).toBeTruthy();

    // Recovery: broker healthy ⇒ the pending order settles.
    __resetBroker();
    await settleOrder(order.id);
    const settled = await getDb().queryOne<{ status: string }>("SELECT status FROM orders_trading WHERE id = ?", [order.id]);
    expect(settled?.status).toBe("settled");
  });

  it("fills are append-only (UPDATE blocked)", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE fills SET fee_minor = 0 WHERE order_id = (SELECT id FROM orders_trading WHERE idempotency_key = 'buy-1')")
    ).rejects.toThrow(/append-only/i);
  });
});
