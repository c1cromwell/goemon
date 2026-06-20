/**
 * Phase 19 Stage-1 — full-bank rails.
 *
 *   - deposit credits user_cash via external_clearing, idempotent on replay;
 *   - withdraw debits user_cash, enforces the balance gate (INSUFFICIENT_FUNDS) and the
 *     account-freeze gate (ACCOUNT_FROZEN), idempotent on replay;
 *   - an ACH return reverses a settled transfer;
 *   - a statement derives opening/closing + line items from the ledger;
 *   - FBO coverage reports the partner bank backing customer cash 1:1;
 *   - BANK_RAILS_ENABLED gates the rails; productionFatals refuses it in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-bank-rails-${Date.now()}.db`;
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
  (config as { BANK_RAILS_ENABLED: boolean }).BANK_RAILS_ENABLED = true;
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
  return createUser(`bank-${seq++}-${Date.now()}@test.com`, "Bank User"); // $10,000 opening
}
async function cash(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("deposit (on-ramp)", () => {
  it("credits user_cash and is idempotent on replay", async () => {
    const { deposit } = await import("../src/services/bankRailService");
    const user = await newUser();
    const before = await cash(user.id);
    const key = `dep-${uuidv4()}`;
    const r1 = await deposit({ userId: user.id, amountMinor: 50_000n, idempotencyKey: key });
    expect(r1.status).toBe("settled");
    expect(await cash(user.id)).toBe(before + 50_000n);

    const r2 = await deposit({ userId: user.id, amountMinor: 50_000n, idempotencyKey: key });
    expect(r2.transferId).toBe(r1.transferId);
    expect(await cash(user.id)).toBe(before + 50_000n); // no double credit
  });
});

describe("withdraw (off-ramp)", () => {
  it("debits user_cash and is idempotent on replay", async () => {
    const { withdraw } = await import("../src/services/bankRailService");
    const user = await newUser();
    const before = await cash(user.id);
    const key = `wd-${uuidv4()}`;
    const r1 = await withdraw({ userId: user.id, amountMinor: 20_000n, method: "ach", destination: "ext-1", idempotencyKey: key });
    expect(r1.status).toBe("settled");
    expect(await cash(user.id)).toBe(before - 20_000n);

    const r2 = await withdraw({ userId: user.id, amountMinor: 20_000n, idempotencyKey: key });
    expect(r2.transferId).toBe(r1.transferId);
    expect(await cash(user.id)).toBe(before - 20_000n); // no double debit
  });

  it("rejects an over-balance withdrawal", async () => {
    const { withdraw } = await import("../src/services/bankRailService");
    const user = await newUser();
    await expect(
      withdraw({ userId: user.id, amountMinor: 99_999_999n, idempotencyKey: `wd-${uuidv4()}` })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("blocks a frozen account", async () => {
    const { withdraw } = await import("../src/services/bankRailService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const user = await newUser();
    await placeHold({ userId: user.id, reason: "test", source: "admin" });
    await expect(
      withdraw({ userId: user.id, amountMinor: 1_000n, idempotencyKey: `wd-${uuidv4()}` })
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("ACH return", () => {
  it("reverses a settled deposit", async () => {
    const { deposit, returnTransfer } = await import("../src/services/bankRailService");
    const user = await newUser();
    const before = await cash(user.id);
    const r = await deposit({ userId: user.id, amountMinor: 30_000n, idempotencyKey: `dep-${uuidv4()}` });
    expect(await cash(user.id)).toBe(before + 30_000n);
    const res = await returnTransfer(r.transferId);
    expect(res.reversed).toBe(true);
    expect(await cash(user.id)).toBe(before); // clawed back
    // idempotent: a second return is a no-op
    expect((await returnTransfer(r.transferId)).reversed).toBe(false);
  });
});

describe("statement", () => {
  it("derives opening/closing and line items from the ledger", async () => {
    const { deposit, withdraw } = await import("../src/services/bankRailService");
    const { getStatement } = await import("../src/services/statementService");
    const user = await newUser();
    await deposit({ userId: user.id, amountMinor: 10_000n, idempotencyKey: `dep-${uuidv4()}` });
    await withdraw({ userId: user.id, amountMinor: 4_000n, idempotencyKey: `wd-${uuidv4()}` });

    // Full-history window: opening is 0 (nothing before epoch) and closing matches the ledger.
    const stmt = await getStatement(user.id, "1970-01-01T00:00:00.000Z", new Date(Date.now() + 60_000).toISOString(), "USD");
    expect(stmt.openingMinor).toBe("0");
    expect(BigInt(stmt.closingMinor)).toBe(await cash(user.id)); // statement reconciles to the ledger
    expect(stmt.lines.length).toBeGreaterThanOrEqual(3); // opening seed + deposit + withdrawal
  });
});

describe("FBO coverage + kill-switch", () => {
  it("reports the FBO backing customer cash 1:1 (single liability snapshot)", async () => {
    const { fboCoverage } = await import("../src/services/bankRailService");
    const c = await fboCoverage("USD");
    expect(c.covered).toBe(true);
    expect(c.fboBalanceMinor).toBe(c.liabilityMinor);
  });

  it("BANK_RAILS_ENABLED gates the rails", async () => {
    const { deposit } = await import("../src/services/bankRailService");
    const { config } = await import("../src/config");
    const user = await newUser();
    (config as { BANK_RAILS_ENABLED: boolean }).BANK_RAILS_ENABLED = false;
    try {
      await expect(deposit({ userId: user.id, amountMinor: 1_000n, idempotencyKey: `dep-${uuidv4()}` })).rejects.toMatchObject({
        code: ErrorCode.BANK_RAILS_DISABLED,
      });
    } finally {
      (config as { BANK_RAILS_ENABLED: boolean }).BANK_RAILS_ENABLED = true;
    }
  });

  it("productionFatals refuses BANK_RAILS_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, BANK_RAILS_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("BANK_RAILS_ENABLED"))).toBe(false);
    const on = { ...base, BANK_RAILS_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("BANK_RAILS_ENABLED"))).toBe(true);
  });
});
