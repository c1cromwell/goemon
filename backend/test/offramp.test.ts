/**
 * USDC → fiat off-ramp (sell USDC for fiat — the exit door).
 *
 *   - quote applies the off-ramp fee and converts the net to fiat (1:1 value);
 *   - an order debits the user's USDC (net → settlement, fee → fee) and is idempotent;
 *   - the balance gate blocks an over-sell (INSUFFICIENT_FUNDS);
 *   - the account-freeze gate blocks a frozen account;
 *   - OFFRAMP_ENABLED gates the rail (OFFRAMP_DISABLED when off);
 *   - productionFatals refuses the simulated off-ramp in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-offramp-${Date.now()}.db`;
let seq = 0;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { OFFRAMP_ENABLED: boolean }).OFFRAMP_ENABLED = true;
  (config as { OFFRAMP_FEE_BPS: number }).OFFRAMP_FEE_BPS = 100; // 1%
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function newUserWithUsdc(micro: bigint) {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount, getOrCreateSystemAccount, postJournal } = await import("../src/services/ledgerService");
  const user = await createUser(`offramp-${seq++}-${Date.now()}@test.com`, "Off-ramp User");
  const src = await getOrCreateSystemAccount("onramp_settlement", "USDC");
  const dst = await getOrCreateUserAccount(user.id, "user_cash", "USDC");
  await postJournal(
    [
      { ledgerAccountId: src, direction: "debit", amountMinor: micro, currency: "USDC" },
      { ledgerAccountId: dst, direction: "credit", amountMinor: micro, currency: "USDC" },
    ],
    "test USDC funding",
    { idempotencyKey: `fund-${uuidv4()}` }
  );
  return user;
}
async function usdc(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USDC"));
}

describe("quote", () => {
  it("applies the off-ramp fee and converts the net to fiat", async () => {
    const { quote } = await import("../src/services/offRampService");
    const q = quote({ usdcAmountMinor: 100_000_000n }); // 100 USDC
    expect(q.feeMinor).toBe(1_000_000n);          // 1 USDC fee
    expect(q.usdcNetMinor).toBe(99_000_000n);     // 99 USDC converted
    expect(q.fiatAmountMinor).toBe(9_900n);       // $99.00 (cents)
    expect(q.fiatCurrency).toBe("USD");
  });
});

describe("createOrder", () => {
  it("debits the user's USDC and is idempotent on replay", async () => {
    const { createOrder } = await import("../src/services/offRampService");
    const user = await newUserWithUsdc(200_000_000n); // 200 USDC
    const before = await usdc(user.id);
    const key = `offramp-${uuidv4()}`;

    const order = await createOrder({ userId: user.id, usdcAmountMinor: 100_000_000n, destination: "••1234", idempotencyKey: key });
    expect(order.status).toBe("completed");
    expect(order.fiatAmountMinor).toBe("9900");
    expect(order.journalId).toBeTruthy();
    expect(before - (await usdc(user.id))).toBe(100_000_000n); // 100 USDC sold

    const replay = await createOrder({ userId: user.id, usdcAmountMinor: 100_000_000n, destination: "••1234", idempotencyKey: key });
    expect(replay.id).toBe(order.id);
    expect(before - (await usdc(user.id))).toBe(100_000_000n); // no double debit
  });

  it("blocks an over-sell (insufficient funds)", async () => {
    const { createOrder } = await import("../src/services/offRampService");
    const user = await newUserWithUsdc(10_000_000n); // 10 USDC
    await expect(createOrder({ userId: user.id, usdcAmountMinor: 50_000_000n, idempotencyKey: `offramp-${uuidv4()}` }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("blocks a frozen account", async () => {
    const { createOrder } = await import("../src/services/offRampService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const user = await newUserWithUsdc(100_000_000n);
    await placeHold({ userId: user.id, reason: "test freeze", source: "admin" });
    await expect(createOrder({ userId: user.id, usdcAmountMinor: 10_000_000n, idempotencyKey: `offramp-${uuidv4()}` }))
      .rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("gating", () => {
  it("OFFRAMP_DISABLED when the rail is off", async () => {
    const { quote } = await import("../src/services/offRampService");
    const { config } = await import("../src/config");
    (config as { OFFRAMP_ENABLED: boolean }).OFFRAMP_ENABLED = false;
    try {
      expect(() => quote({ usdcAmountMinor: 10_000_000n })).toThrow();
    } finally {
      (config as { OFFRAMP_ENABLED: boolean }).OFFRAMP_ENABLED = true;
    }
  });

  it("productionFatals refuses the simulated off-ramp in prod", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, BANK_RAILS_ENABLED: false,
      OFFRAMP_ENABLED: false, OFFRAMP_PROVIDER: "simulated",
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("OFFRAMP_ENABLED"))).toBe(false);
    const on = { ...base, OFFRAMP_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("OFFRAMP_ENABLED"))).toBe(true);
  });
});
