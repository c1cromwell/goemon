/**
 * SmartChat over the new money rails (Phase 19) — natural-language deposit, withdraw,
 * and bill pay route through the same operation-token + MFA pipeline as transfers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";

const TMP_DB = `./data/test-smartchat-rails-${Date.now()}.db`;
let seq = 0;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as Record<string, boolean>).BANK_RAILS_ENABLED = true;
  (config as Record<string, boolean>).BILLPAY_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function newUser() {
  const { createUser } = await import("../src/services/authService");
  return createUser(`sc-${seq++}-${Date.now()}@test.com`, "SC User"); // $10,000
}
async function cash(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("classifier", () => {
  it("recognizes deposit / withdraw / bill pay", async () => {
    const { classifyIntentSimulated } = await import("../src/utils/smartchatModel");
    expect(classifyIntentSimulated("deposit $50").operation).toBe("bank.deposit");
    expect(classifyIntentSimulated("withdraw $20 to my bank").operation).toBe("bank.withdraw");
    const bill = classifyIntentSimulated('pay "City Power" $90');
    expect(bill.operation).toBe("bill.pay");
    expect(bill.payee).toBe("City Power");
    expect(classifyIntentSimulated("send $10 to blair@demo.com").operation).toBe("transfer.send");
  });
});

describe("execution", () => {
  it("deposit credits the account", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const user = await newUser();
    const before = await cash(user.id);
    const res = await handleMessage({ userId: user.id, message: "deposit $50" });
    expect(res.requiresMfa).toBe(false);
    expect(await cash(user.id)).toBe(before + 5_000n);
    expect(res.reply.toLowerCase()).toContain("deposit");
  });

  it("withdraw debits the account", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const user = await newUser();
    const before = await cash(user.id);
    await handleMessage({ userId: user.id, message: "withdraw $20 to my bank" });
    expect(await cash(user.id)).toBe(before - 2_000n);
  });

  it("a >$500 withdrawal requires MFA (no money moves until verified)", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const user = await newUser();
    const before = await cash(user.id);
    const res = await handleMessage({ userId: user.id, message: "withdraw $600 to my bank" });
    expect(res.requiresMfa).toBe(true);
    expect(await cash(user.id)).toBe(before); // gated
  });

  it("bill pay resolves a saved payee by name and pays it", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const { addPayee } = await import("../src/services/billPayService");
    const user = await newUser();
    await addPayee({ userId: user.id, name: "City Power", category: "utility" });
    const before = await cash(user.id);
    const res = await handleMessage({ userId: user.id, message: 'pay "City Power" $30' });
    expect(res.requiresMfa).toBe(false);
    expect(await cash(user.id)).toBe(before - 3_000n);
    expect(res.reply).toContain("City Power");
  });
});
