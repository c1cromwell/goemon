/**
 * X-Money response F1 — tokenized yield-bearing Treasury.
 *
 *   1. subscribe: cash → tokens at par; the user holds a non-custodial asset position.
 *   2. accrueYield: distributes the period's yield PRO-RATA to every holder as cash
 *      (the anti-6%-APY — "own a yield-bearing asset").
 *   3. distribution is idempotent (re-running pays no one twice).
 *   4. redeem: tokens → cash at par.
 *   5. subscribe is idempotent on the key; insufficient funds is rejected.
 *   6. TREASURY_ENABLED off ⇒ disabled; productionFatals refuses it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";

const TMP_DB = `./data/test-treasury-${Date.now()}.db`;

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
  (config as { TREASURY_ENABLED: boolean }).TREASURY_ENABLED = true;
  (config as { TREASURY_APY_BPS: number }).TREASURY_APY_BPS = 450;
  const { seedTreasury } = await import("../src/services/treasuryService");
  await seedTreasury();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function cashOf(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}
async function newUser(tag: string): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`treas-${tag}-${Date.now()}-${Math.random()}@test.com`, "T");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  return u.id;
}

describe("Tokenized Treasury (F1) — own a yield-bearing asset", () => {
  it("subscribe: $100 cash → 100 tokens at par; holding + cash debit are exact", async () => {
    const { subscribe, positions } = await import("../src/services/treasuryService");
    const u = await newUser("sub");
    const before = await cashOf(u);
    const r = await subscribe({ userId: u, qtyBase: 100n, idempotencyKey: uuidv4() });
    expect(r.qtyBase).toBe("100");
    expect(r.costMinor).toBe("10000"); // 100 tokens × $1.00 par
    expect(await cashOf(u)).toBe(before - 10_000n);
    const pos = await positions(u);
    expect(pos.qtyBase).toBe("100");
    expect(pos.valueMinor).toBe("10000");
  });

  it("accrueYield: distributes the period's yield PRO-RATA to all holders as cash", async () => {
    const { subscribe, accrueYield } = await import("../src/services/treasuryService");
    const a = await newUser("a");
    const b = await newUser("b");
    await subscribe({ userId: a, qtyBase: 100n, idempotencyKey: uuidv4() });
    await subscribe({ userId: b, qtyBase: 300n, idempotencyKey: uuidv4() });
    const aBefore = await cashOf(a);
    const bBefore = await cashOf(b);

    // 1 year at 4.5% on a $1 token → perUnit = floor(100 × 450 × 365 / (10000 × 365)) = 4 minor.
    const res = await accrueYield({ periodDays: 365 });
    expect(res.perUnitMinor).toBe("4");
    expect(res.holdersPaid).toBeGreaterThanOrEqual(2);

    expect(await cashOf(a)).toBe(aBefore + 400n);  // 100 × 4
    expect(await cashOf(b)).toBe(bBefore + 1_200n); // 300 × 4  — exactly pro-rata
  });

  it("distribution is idempotent (re-running pays no holder twice)", async () => {
    const { subscribe, accrueYield } = await import("../src/services/treasuryService");
    const { distributeDividend } = await import("../src/services/corporateActionService");
    const u = await newUser("idem");
    await subscribe({ userId: u, qtyBase: 100n, idempotencyKey: uuidv4() });
    const res = await accrueYield({ periodDays: 365 });
    const after = await cashOf(u);
    const again = await distributeDividend(res.corporateActionId); // re-run the same action
    expect(again.holdersPaid).toBe(0);     // nobody paid twice
    expect(await cashOf(u)).toBe(after);    // balance unchanged
  });

  it("redeem: 50 tokens → $50 cash at par", async () => {
    const { subscribe, redeem, positions } = await import("../src/services/treasuryService");
    const u = await newUser("red");
    await subscribe({ userId: u, qtyBase: 100n, idempotencyKey: uuidv4() });
    const mid = await cashOf(u);
    const r = await redeem({ userId: u, qtyBase: 50n, idempotencyKey: uuidv4() });
    expect(r.proceedsMinor).toBe("5000");
    expect(await cashOf(u)).toBe(mid + 5_000n);
    expect((await positions(u)).qtyBase).toBe("50");
  });

  it("subscribe is idempotent on the key; insufficient funds is rejected", async () => {
    const { subscribe } = await import("../src/services/treasuryService");
    const { ErrorCode } = await import("../src/errors");
    const u = await newUser("idem2");
    const before = await cashOf(u);
    const key = uuidv4();
    await subscribe({ userId: u, qtyBase: 100n, idempotencyKey: key });
    await subscribe({ userId: u, qtyBase: 100n, idempotencyKey: key }); // replay
    expect(await cashOf(u)).toBe(before - 10_000n); // debited once, not twice

    await expect(subscribe({ userId: u, qtyBase: 999_999_999n, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("TREASURY_ENABLED off ⇒ disabled; productionFatals refuses it", async () => {
    const { config } = await import("../src/config");
    const { subscribe } = await import("../src/services/treasuryService");
    (config as { TREASURY_ENABLED: boolean }).TREASURY_ENABLED = false;
    try {
      await expect(subscribe({ userId: "x", qtyBase: 1n, idempotencyKey: uuidv4() })).rejects.toMatchObject({ code: "EQUITIES_DISABLED" });
    } finally {
      (config as { TREASURY_ENABLED: boolean }).TREASURY_ENABLED = true;
    }
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, TREASURY_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("TREASURY_ENABLED"))).toBe(false);
    const on = { ...base, TREASURY_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("TREASURY_ENABLED"))).toBe(true);
  });
});
