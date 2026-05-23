/**
 * Phase 0/1 — Foundation tests.
 *
 * These verify the money invariants and the DB abstraction. They run against a
 * temporary SQLite database. Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Money } from "../src/db/money";

describe("Money (Phase 0 invariants)", () => {
  it("constructs USD from cents and formats with symbol", () => {
    const m = Money.usd(1000000n);
    expect(m.toMinor()).toBe(1000000n);
    expect(m.format({ withSymbol: true })).toBe("$10,000.00");
  });

  it("adds and subtracts exactly (no float error)", () => {
    const a = Money.usd(10n); // $0.10
    const b = Money.usd(20n); // $0.20
    const sum = a.add(b);
    expect(sum.toMinor()).toBe(30n); // exactly $0.30 — the classic 0.1+0.2 trap avoided
    expect(sum.format({ withSymbol: true })).toBe("$0.30");
  });

  it("rejects cross-currency math", () => {
    const usd = Money.usd(100n);
    const usdc = Money.usdc(100n);
    expect(() => usd.add(usdc)).toThrow(/Currency mismatch/);
  });

  it("reads from DB string (pg) and number (sqlite) identically", () => {
    const fromPg = Money.fromDb("1000000", "USD");
    const fromSqlite = Money.fromDb(1000000, "USD");
    expect(fromPg.toMinor()).toBe(fromSqlite.toMinor());
  });

  it("serializes to JSON as a string amount (precision-safe)", () => {
    const m = Money.usdc(123456789012345n);
    const j = m.toJSON();
    expect(typeof j.amount).toBe("string");
    expect(Money.fromJSON(j).toMinor()).toBe(123456789012345n);
  });

  it("handles USDC 6-decimal formatting", () => {
    const m = Money.usdc(1500000n); // 1.5 USDC
    expect(m.format()).toBe("1.500000 USDC");
  });
});

describe("DB abstraction (Phase 1)", () => {
  // These run against SQLite by leaving DATABASE_URL unset and pointing at a temp file.
  const tmp = `./data/test-${Date.now()}.db`;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SQLITE_PATH = tmp;
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
    // config and db are imported lazily so the env above is honored.
  });

  afterAll(async () => {
    const { closeDb } = await import("../src/db");
    await closeDb();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(tmp + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it("runs migrations and round-trips integer money exactly", async () => {
    const { runMigrations } = await import("../src/db/migrate");
    const { getDb } = await import("../src/db");
    await runMigrations();
    const db = getDb();

    await db.execute("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)", ["u1", "a@b.com", "Test"]);
    await db.execute(
      "INSERT INTO accounts (id, user_id, account_number, balance_minor, currency) VALUES (?, ?, ?, ?, ?)",
      ["acc1", "u1", "0001", 999999999n, "USD"]
    );

    const row = await db.queryOne<{ balance_minor: string | number }>(
      "SELECT balance_minor FROM accounts WHERE id = ?",
      ["acc1"]
    );
    const balance = Money.fromDb(row!.balance_minor, "USD");
    expect(balance.toMinor()).toBe(999999999n); // $9,999,999.99 exact
  });

  it("blocks UPDATE on append-only audit_logs", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();
    await db.execute("INSERT INTO audit_logs (id, action) VALUES (?, ?)", ["a1", "TEST"]);
    await expect(db.execute("UPDATE audit_logs SET action = ? WHERE id = ?", ["HACKED", "a1"])).rejects.toThrow();
  });
});
