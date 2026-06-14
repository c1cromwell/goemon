/**
 * Phase 20 — money-path on Temporal.
 *
 * The live e2e is `npm run money:live-check` (a real server). Here we assert:
 *   - executeTransfer degrades to the direct ledger transfer when Temporal is enabled
 *     but unreachable — funds move correctly (never fails open).
 *   - exactly-once: replaying the same idempotency key collapses onto one journal and
 *     debits once (the property Temporal preserves via the idempotent ledger activity).
 *   - the money activity converts the decimal-string amount back to bigint (no floats).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { executeTransfer } from "../src/money/moneyEngine";
import { transferActivity } from "../src/money/moneyActivities";

const TMP_DB = `./data/test-money-temporal-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("executeTransfer degrades to direct when Temporal is unreachable", () => {
  it("still moves funds and stays exactly-once on replay", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const { config } = await import("../src/config");

    const alice = await createUser(`mt-a-${Date.now()}@test.com`, "Alice"); // $10,000
    const bob = await createUser(`mt-b-${Date.now()}@test.com`, "Bob");
    const aliceAcct = await getOrCreateUserAccount(alice.id, "user_cash", "USD");
    const key = `mt-${uuidv4()}`;

    // Temporal enabled but pointed at an unreachable server → fast fallback to direct.
    const origEnabled = config.TEMPORAL_MONEY_ENABLED;
    const origAddr = config.TEMPORAL_ADDRESS;
    (config as { TEMPORAL_MONEY_ENABLED: boolean }).TEMPORAL_MONEY_ENABLED = true;
    (config as { TEMPORAL_ADDRESS: string }).TEMPORAL_ADDRESS = "127.0.0.1:1";
    try {
      const r1 = await executeTransfer({ fromUserId: alice.id, toUserId: bob.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key, channel: "api" });
      const r2 = await executeTransfer({ fromUserId: alice.id, toUserId: bob.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key, channel: "api" });
      expect(r2.journalId).toBe(r1.journalId); // exactly-once: same journal
      expect(await getBalance(aliceAcct)).toBe(1_000_000n - 2500n); // debited once, not twice
    } finally {
      (config as { TEMPORAL_MONEY_ENABLED: boolean }).TEMPORAL_MONEY_ENABLED = origEnabled;
      (config as { TEMPORAL_ADDRESS: string }).TEMPORAL_ADDRESS = origAddr;
    }
  }, 20000);
});

describe("money activity (wire conversion)", () => {
  it("converts the decimal-string amount to bigint and posts the transfer", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const alice = await createUser(`ma-a-${Date.now()}@test.com`, "Alice");
    const bob = await createUser(`ma-b-${Date.now()}@test.com`, "Bob");
    const aliceAcct = await getOrCreateUserAccount(alice.id, "user_cash", "USD");

    const res = await transferActivity({
      fromUserId: alice.id, toUserId: bob.id, amountMinor: "750", currency: "USD", idempotencyKey: `ma-${uuidv4()}`, channel: "api",
    });
    expect(res.journalId).toBeTruthy();
    expect(await getBalance(aliceAcct)).toBe(1_000_000n - 750n);
  });
});
