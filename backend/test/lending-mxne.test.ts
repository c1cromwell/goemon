/**
 * Feature D — non-USD-denominated lending ("peso-denominated lend-borrow").
 *
 * Borrow MXNe against USD-par Treasury (ATB) collateral: the collateral is FX-valued into
 * the borrow currency, disbursement/repayment ride MXNe ledger legs, and the full
 * open → accrue → repay → release lifecycle balances. USD loans are unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-lending-mxne-${Date.now()}.db`;
let ATB_ID = "";
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
  (config as { TREASURY_ENABLED: boolean }).TREASURY_ENABLED = true;
  (config as { LENDING_ENABLED: boolean }).LENDING_ENABLED = true;
  (config as { FX_ENABLED: boolean }).FX_ENABLED = true;
  (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
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

async function userWithCollateral(tokens = 100n) {
  const { createUser } = await import("../src/services/authService");
  const { subscribe } = await import("../src/services/treasuryService");
  const user = await createUser(`lend-mx-${seq++}-${Date.now()}@test.com`, "Lend MX User");
  await subscribe({ userId: user.id, qtyBase: tokens, idempotencyKey: `sub-${uuidv4()}` });
  return user;
}
async function bal(userId: string, ccy: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", ccy));
}
async function atbHolding(userId: string): Promise<bigint> {
  const { getOrCreateUserAssetAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAssetAccount(userId, ATB_ID));
}

describe("Feature D: MXNe-denominated lending", () => {
  it("FX-values USD-par collateral into MXNe for borrowing power", async () => {
    const { borrowingPower } = await import("../src/services/lendingService");
    // $100 collateral × ~18.18 MXN/USD → ~1,818 MXNe; 50% LTV → ~909 MXNe.
    const bp = await borrowingPower(ATB_ID, 100n, "MXNE");
    expect(bp.borrowCurrency).toBe("MXNE");
    expect(bp.collateralValueMinor).toBe("1818181800"); // 1,818.1818 MXNe (6dp)
    expect(bp.maxBorrowMinor).toBe("909090900"); // 909.0909 MXNe
  });

  it("opens, accrues, and fully repays a MXNe loan, releasing the collateral", async () => {
    const { openLoan, accrueInterest, repay } = await import("../src/services/lendingService");
    const { convert } = await import("../src/services/fxSettlementService");
    const user = await userWithCollateral();

    // Borrow 900 MXNe (under the ~909 max) against 100 ATB.
    const loan = await openLoan({
      userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n,
      borrowMinor: 900_000_000n, borrowCurrency: "MXNE", idempotencyKey: `loan-${uuidv4()}`,
    });
    expect(loan.borrowCurrency).toBe("MXNE");
    expect(loan.principalMinor).toBe("900000000");
    expect(await bal(user.id, "MXNE")).toBe(900_000_000n); // MXNe disbursed
    expect(await atbHolding(user.id)).toBe(0n); // collateral locked

    // Top up MXNe (from USD) so the borrower can cover principal + interest.
    await convert({ userId: user.id, from: "USD", to: "MXNE", fromAmountMinor: 1_000n, idempotencyKey: `fx-${uuidv4()}` });

    // 365d @ 8% APR on 900 MXNe principal → 72 MXNe interest.
    const accrued = await accrueInterest(loan.id, { periodDays: 365 });
    expect(accrued.accruedInterestMinor).toBe("72000000");
    expect(accrued.outstandingMinor).toBe("972000000");

    const repaid = await repay({ userId: user.id, loanId: loan.id, amountMinor: 972_000_000n, idempotencyKey: `repay-${uuidv4()}` });
    expect(repaid.status).toBe("repaid");
    expect(repaid.outstandingMinor).toBe("0");
    expect(await atbHolding(user.id)).toBe(100n); // collateral released back
  });

  it("still defaults to USD when no borrow currency is given (unchanged behavior)", async () => {
    const { openLoan } = await import("../src/services/lendingService");
    const user = await userWithCollateral();
    const before = await bal(user.id, "USD");
    const loan = await openLoan({
      userId: user.id, collateralAssetId: ATB_ID, collateralQtyBase: 100n,
      borrowMinor: 5_000n, idempotencyKey: `loan-${uuidv4()}`,
    });
    expect(loan.borrowCurrency).toBe("USD");
    expect(await bal(user.id, "USD")).toBe(before + 5_000n);
  });
});
