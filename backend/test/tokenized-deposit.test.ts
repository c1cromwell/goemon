/**
 * Tokenized-deposit readiness seam (R2) — see docs/business/SWIFT-SHARED-LEDGER-ASSESSMENT.md.
 *
 * Custody/mirror a partner-bank-issued deposit token (USDD) like USDC: issue mirrors in as a
 * balanced external_clearing→user_cash journal, redeem reverses it, USDD transfers on the ledger
 * via the registry gate, yield accrues (the differentiator over a stablecoin), and the whole seam
 * is off unless TOKENIZED_DEPOSITS_ENABLED.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-tokdep-${Date.now()}.db`;
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
  (config as { TOKENIZED_DEPOSITS_ENABLED: boolean }).TOKENIZED_DEPOSITS_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function newUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const u = await createUser(`tokdep-${seq++}-${Date.now()}@test.com`, "TokDep User");
  return u.id;
}
async function usdd(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USDD"));
}

describe("R2: tokenized-deposit readiness seam", () => {
  it("issues (mirrors a bank mint) as a balanced journal, idempotently", async () => {
    const { issue } = await import("../src/services/tokenizedDepositService");
    const { getOrCreateSystemAccount, getBalance } = await import("../src/services/ledgerService");
    const user = await newUser();
    const clearingBefore = await getBalance(await getOrCreateSystemAccount("external_clearing", "USDD"));

    const key = `iss-${uuidv4()}`;
    const r1 = await issue({ userId: user, amountMinor: 1_000_000_000n, idempotencyKey: key }); // 1,000 USDD
    expect(await usdd(user)).toBe(1_000_000_000n);
    // external_clearing debited (the bank's mint mirrored in) — nets against the credit.
    expect(await getBalance(await getOrCreateSystemAccount("external_clearing", "USDD"))).toBe(clearingBefore - 1_000_000_000n);

    // Idempotent replay: same journal, no double credit.
    const r2 = await issue({ userId: user, amountMinor: 1_000_000_000n, idempotencyKey: key });
    expect(r2.journalId).toBe(r1.journalId);
    expect(await usdd(user)).toBe(1_000_000_000n);
  });

  it("redeems back to the bank and rejects an over-redeem", async () => {
    const { issue, redeem } = await import("../src/services/tokenizedDepositService");
    const { ErrorCode } = await import("../src/errors");
    const user = await newUser();
    await issue({ userId: user, amountMinor: 500_000_000n, idempotencyKey: `iss-${uuidv4()}` });

    await redeem({ userId: user, amountMinor: 200_000_000n, idempotencyKey: `red-${uuidv4()}` });
    expect(await usdd(user)).toBe(300_000_000n);

    await expect(
      redeem({ userId: user, amountMinor: 400_000_000n, idempotencyKey: `red-${uuidv4()}` })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("transfers USDD user→user on the ledger (registry-gated)", async () => {
    const { issue } = await import("../src/services/tokenizedDepositService");
    const { transfer } = await import("../src/services/transferService");
    const alice = await newUser();
    const bob = await newUser();
    await issue({ userId: alice, amountMinor: 1_000_000_000n, idempotencyKey: `iss-${uuidv4()}` });

    await transfer({ fromUserId: alice, toUserId: bob, amountMinor: 250_000_000n, currency: "USDD", idempotencyKey: `t-${uuidv4()}` });
    expect(await usdd(bob)).toBe(250_000_000n);
    expect(await usdd(alice)).toBe(750_000_000n);
  });

  it("accrues yield to a holder (the differentiator over a stablecoin)", async () => {
    const { issue, accrueInterest, getPosition } = await import("../src/services/tokenizedDepositService");
    const user = await newUser();
    await issue({ userId: user, amountMinor: 1_000_000_000n, idempotencyKey: `iss-${uuidv4()}` });

    // 365d at the default 4% APY on 1,000 USDD → 40 USDD.
    const acc = await accrueInterest({ userId: user, periodDays: 365 });
    expect(acc.interestMinor).toBe("40000000");
    expect(await usdd(user)).toBe(1_040_000_000n);

    const pos = await getPosition(user);
    expect(pos.balanceMinor).toBe("1040000000");
    expect(pos.currency).toBe("USDD");
    expect(pos.apyBps).toBe(400);
  });

  it("is disabled when TOKENIZED_DEPOSITS_ENABLED is off", async () => {
    const { issue } = await import("../src/services/tokenizedDepositService");
    const { config } = await import("../src/config");
    const { ErrorCode } = await import("../src/errors");
    const user = await newUser();
    (config as { TOKENIZED_DEPOSITS_ENABLED: boolean }).TOKENIZED_DEPOSITS_ENABLED = false;
    try {
      await expect(
        issue({ userId: user, amountMinor: 1_000n, idempotencyKey: `iss-${uuidv4()}` })
      ).rejects.toMatchObject({ code: ErrorCode.TOKENIZED_DEPOSITS_DISABLED });
    } finally {
      (config as { TOKENIZED_DEPOSITS_ENABLED: boolean }).TOKENIZED_DEPOSITS_ENABLED = true;
    }
  });
});
