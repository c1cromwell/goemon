/**
 * Collateralized lending (PRD v2 prototype) — borrow USD against pledged Treasury (ATB)
 * tokens, valued at par.
 *
 *   - quote reports borrowing power (max LTV × collateral value);
 *   - open locks the collateral, disburses USD, and refuses a borrow over the max LTV;
 *   - the account-freeze gate blocks a frozen account;
 *   - interest accrues on the outstanding principal;
 *   - full repayment closes the loan and releases the collateral back to the holding;
 *   - a loan whose debt breaches the liquidation LTV is liquidated (surplus returned);
 *   - LENDING_ENABLED gates the rail; productionFatals refuses it in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-lending-${Date.now()}.db`;
let seq = 0;
let ATB_ID = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { TREASURY_ENABLED: boolean }).TREASURY_ENABLED = true;
  (config as { LENDING_ENABLED: boolean }).LENDING_ENABLED = true;
  const { seedTreasury } = await import("../src/services/treasuryService");
  ATB_ID = (await seedTreasury()).id;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

/** A fresh user with $100 of ATB collateral (100 tokens at $1 par) + remaining cash. */
async function userWithCollateral(tokens = 100n) {
  const { createUser } = await import("../src/services/authService");
  const { subscribe } = await import("../src/services/treasuryService");
  const user = await createUser(`lend-${seq++}-${Date.now()}@test.com`, "Lend User"); // $10,000 USD
  await subscribe({ userId: user.id, qtyBase: tokens, idempotencyKey: `sub-${uuidv4()}` });
  return user;
}
async function cashUSD(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}
async function atbHolding(userId: string): Promise<bigint> {
  const { getOrCreateUserAssetAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAssetAccount(userId, ATB_ID));
}

describe("quote + open", () => {
  it("reports borrowing power and disburses USD against locked collateral", async () => {
    const { openLoan, borrowingPower } = await import("../src/services/lendingService");
    const user = await userWithCollateral();

    const bp = await borrowingPower(ATB_ID, 100n);
    expect(bp.collateralValueMinor).toBe("10000"); // $100
    expect(bp.maxBorrowMinor).toBe("5000");        // 50% LTV → $50

    const before = await cashUSD(user.id);
    const loan = await openLoan({ userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n, borrowMinor: 5000n, idempotencyKey: `loan-${uuidv4()}` });
    expect(loan.status).toBe("active");
    expect(loan.principalMinor).toBe("5000");
    expect(await cashUSD(user.id)).toBe(before + 5000n); // received the loan
    expect(await atbHolding(user.id)).toBe(0n);          // collateral locked away
  });

  it("refuses a borrow over the max LTV", async () => {
    const { openLoan } = await import("../src/services/lendingService");
    const user = await userWithCollateral();
    await expect(openLoan({ userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n, borrowMinor: 6000n, idempotencyKey: `loan-${uuidv4()}` }))
      .rejects.toMatchObject({ code: ErrorCode.LTV_EXCEEDED });
  });

  it("blocks a frozen account", async () => {
    const { openLoan } = await import("../src/services/lendingService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const user = await userWithCollateral();
    await placeHold({ userId: user.id, reason: "test freeze", source: "admin" });
    await expect(openLoan({ userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n, borrowMinor: 5000n, idempotencyKey: `loan-${uuidv4()}` }))
      .rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("accrue + repay", () => {
  it("accrues interest then full repayment releases the collateral", async () => {
    const { openLoan, accrueInterest, repay } = await import("../src/services/lendingService");
    const user = await userWithCollateral();
    const loan = await openLoan({ userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n, borrowMinor: 5000n, idempotencyKey: `loan-${uuidv4()}` });

    // 365 days at 8% APR on $50 principal → $4 interest.
    const accrued = await accrueInterest(loan.id, { periodDays: 365 });
    expect(accrued.accruedInterestMinor).toBe("400");
    expect(accrued.outstandingMinor).toBe("5400");

    // Repay the full outstanding; collateral returns, loan closes.
    const repaid = await repay({ userId: user.id, loanId: loan.id, amountMinor: 5400n, idempotencyKey: `repay-${uuidv4()}` });
    expect(repaid.status).toBe("repaid");
    expect(repaid.outstandingMinor).toBe("0");
    expect(await atbHolding(user.id)).toBe(100n); // collateral released back
  });
});

describe("liquidation", () => {
  it("liquidates a loan whose debt breaches the liquidation LTV and returns the surplus", async () => {
    const { openLoan, accrueInterest, liquidate } = await import("../src/services/lendingService");
    const user = await userWithCollateral();
    const loan = await openLoan({ userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n, borrowMinor: 5000n, idempotencyKey: `loan-${uuidv4()}` });

    // Healthy at first.
    const stillHealthy = await liquidate(loan.id);
    expect(stillHealthy.liquidated).toBe(false);

    // Accrue ~7 years of interest → outstanding ≈ $78 > 75% × $100 ceiling.
    await accrueInterest(loan.id, { periodDays: 365 * 7 });
    const cashBefore = await cashUSD(user.id);

    const result = await liquidate(loan.id);
    expect(result.liquidated).toBe(true);
    expect(result.loan.status).toBe("liquidated");
    expect(result.loan.outstandingMinor).toBe("0");
    // Collateral value $100 covered the ~$78 debt; the rest is returned to the user.
    expect(await cashUSD(user.id)).toBeGreaterThan(cashBefore);
  });
});

describe("gating", () => {
  it("LENDING_DISABLED when the rail is off", async () => {
    const { borrowingPower } = await import("../src/services/lendingService");
    const { config } = await import("../src/config");
    (config as { LENDING_ENABLED: boolean }).LENDING_ENABLED = false;
    try {
      await expect(borrowingPower(ATB_ID, 100n)).rejects.toMatchObject({ code: ErrorCode.LENDING_DISABLED });
    } finally {
      (config as { LENDING_ENABLED: boolean }).LENDING_ENABLED = true;
    }
  });

  it("productionFatals refuses LENDING_ENABLED in prod", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, BANK_RAILS_ENABLED: false, LENDING_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("LENDING_ENABLED"))).toBe(false);
    const on = { ...base, LENDING_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("LENDING_ENABLED"))).toBe(true);
  });
});
