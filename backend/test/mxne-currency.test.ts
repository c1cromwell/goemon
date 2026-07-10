/**
 * Feature C — first non-USD (local-currency) stablecoin, MXNe.
 *
 * The report's "the dollar is settled; the race is local currency." Proves MXNe is a
 * first-class ledger/FX-layer currency: it quotes, converts (money movement), and
 * transfers as balanced per-currency journals — with no change to the USD/USDC paths.
 * (On-chain settlement + ramps stay USD/USDC-pinned by design and are not exercised here.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-mxne-${Date.now()}.db`;

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
  (config as { FX_ENABLED: boolean }).FX_ENABLED = true;
  (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
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

async function fundedUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`mxne-${Date.now()}-${Math.random()}@test.com`, "MXNe User");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  return u.id;
}

describe("Feature C: MXNe local stablecoin", () => {
  it("is registry-enabled at 6 decimals", async () => {
    const { isSupportedCurrency, getCurrency } = await import("../src/services/currencyRegistry");
    expect(isSupportedCurrency("MXNE")).toBe(true);
    expect(getCurrency("MXNE")?.decimals).toBe(6);
    expect(getCurrency("MXNE")?.kind).toBe("stablecoin");
  });

  it("quotes USD → MXNe at the simulated peso rate (~18.18 MXN/USD)", async () => {
    const { quote } = await import("../src/services/fxRateService");
    const q = await quote({ from: "USD", to: "MXNE", amountMinor: 100n }); // $1.00
    expect(Number(q.rate)).toBeGreaterThan(18);
    expect(Number(q.rate)).toBeLessThan(18.2);
    expect(BigInt(q.toAmountMinor)).toBeGreaterThan(0n); // ~18.18 MXNe in micro-units
    expect(q.source).toBe("simulated");
  });

  it("converts USD → MXNe as one balanced journal (user debited, credited net, fee captured)", async () => {
    const { convert } = await import("../src/services/fxSettlementService");
    const { getOrCreateUserAccount, getOrCreateSystemAccount, getBalance } = await import("../src/services/ledgerService");
    const userId = await fundedUser();
    const usd = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const mxne = await getOrCreateUserAccount(userId, "user_cash", "MXNE");
    const usdBefore = await getBalance(usd);

    const r = await convert({ userId, from: "USD", to: "MXNE", fromAmountMinor: 10_000n, idempotencyKey: `mx-${Date.now()}` });
    // $100 → ~1818 MXNe gross (100 × ~18.18), less a 50bps spread.
    expect(Number(r.grossToMinor)).toBeGreaterThan(1_800_000_000);
    expect(Number(r.grossToMinor)).toBeLessThan(1_820_000_000);

    expect(await getBalance(usd)).toBe(usdBefore - 10_000n); // FROM debited
    expect(await getBalance(mxne)).toBe(BigInt(r.toAmountMinor)); // TO credited net
    const feeAcct = await getOrCreateSystemAccount("fee", "MXNE");
    expect(await getBalance(feeAcct)).toBeGreaterThan(0n); // spread captured in MXNe
  });

  it("transfers MXNe user→user as a balanced per-currency journal", async () => {
    const { convert } = await import("../src/services/fxSettlementService");
    const { transfer } = await import("../src/services/transferService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const alice = await fundedUser();
    const bob = await fundedUser();
    // Give Alice MXNe via conversion, then send some to Bob.
    await convert({ userId: alice, from: "USD", to: "MXNE", fromAmountMinor: 5_000n, idempotencyKey: `mx2-${Date.now()}` });
    const bobMxne = await getOrCreateUserAccount(bob, "user_cash", "MXNE");
    expect(await getBalance(bobMxne)).toBe(0n);

    await transfer({
      fromUserId: alice,
      toUserId: bob,
      amountMinor: 100_000_000n, // 100 MXNe
      currency: "MXNE",
      idempotencyKey: `t-${Date.now()}`,
    });
    expect(await getBalance(bobMxne)).toBe(100_000_000n);
  });

  it("still rejects a disabled/unknown currency at the transfer gate (VALIDATION)", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");
    const alice = await fundedUser();
    const bob = await fundedUser();
    await expect(
      transfer({ fromUserId: alice, toUserId: bob, amountMinor: 1_000n, currency: "EURC", idempotencyKey: `x-${Date.now()}` })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });
});
