/**
 * Phase 29 P4 — employee equity compensation.
 *
 * Vesting math (cliff + linear), delivery of vested restricted units, option exercise
 * (pay price → receive units), 83(b) tracking, cap table, pool limit, and kill-switch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-equitycomp-${Date.now()}.db`;

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
  (config as { EQUITY_COMP_ENABLED: boolean }).EQUITY_COMP_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  const fs = require("fs");
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + s); } catch { /* ignore */ } }
});

let seq = 0;
async function makeUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`eq-${seq++}-${Date.now()}@test.com`, "Grantee");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // seeds a $10,000 opening balance
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}

async function makeEquityAsset(supply: bigint, issuer?: string) {
  const { createAsset } = await import("../src/services/tokenizationService");
  return createAsset({ kind: "equity", tokenStandard: "erc3643", name: "NewCo Common", symbol: "NEWCO", issuerUserId: issuer, initialSupply: supply });
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

describe("equity comp — vesting math", () => {
  it("cliff then linear: 0 before cliff, 25% at 1yr, 100% at 4yr", async () => {
    const { computeVested } = await import("../src/services/equityCompService");
    const grant = {
      id: "g", assetId: "a", recipientUserId: "r", grantorUserId: null, awardType: "unit_award" as const,
      unitsTotal: 4800n, unitsReleased: 0n, exercisePriceMinor: 0n, thresholdMinor: 0n, currency: "USD",
      vestStart: iso(2020, 1, 1), cliffMonths: 12, durationMonths: 48, eightyThreeBFiled: false,
      eightyThreeBDeadline: null, status: "active", createdAt: iso(2020, 1, 1),
    };
    expect(computeVested(grant, new Date(iso(2020, 6, 1)))).toBe(0n); // before cliff
    expect(computeVested(grant, new Date(iso(2021, 1, 1)))).toBe(1200n); // 12/48 = 25%
    expect(computeVested(grant, new Date(iso(2022, 1, 1)))).toBe(2400n); // 24/48 = 50%
    expect(computeVested(grant, new Date(iso(2024, 1, 1)))).toBe(4800n); // fully vested
    expect(computeVested(grant, new Date(iso(2030, 1, 1)))).toBe(4800n); // capped
  });
});

describe("equity comp — grants, release, exercise, cap table", () => {
  it("delivers vested restricted units on release (idempotent)", async () => {
    const { createGrant, releaseVested } = await import("../src/services/equityCompService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const asset = await makeEquityAsset(10_000n);
    const grantee = await makeUser();
    const grant = await createGrant({
      assetId: asset.id, recipientUserId: grantee, awardType: "unit_award",
      unitsTotal: 4800n, vestStart: iso(2020, 1, 1), cliffMonths: 12, durationMonths: 48,
    });
    // 83(b) deadline is set 30 days after vest start.
    expect(grant.eightyThreeBDeadline).toBeTruthy();

    // Release as of 1 year → 1200 delivered.
    const r1 = await releaseVested(grant.id, new Date(iso(2021, 1, 1)));
    expect(r1.unitsReleased).toBe(1200n);
    expect(await getAssetBalance(grantee, asset.id)).toBe(1200n);
    // Re-run at the same date → no double delivery.
    const r1b = await releaseVested(grant.id, new Date(iso(2021, 1, 1)));
    expect(r1b.unitsReleased).toBe(1200n);
    expect(await getAssetBalance(grantee, asset.id)).toBe(1200n);
    // Fully vest → all delivered, grant closed.
    const r2 = await releaseVested(grant.id, new Date(iso(2024, 1, 1)));
    expect(r2.unitsReleased).toBe(4800n);
    expect(r2.status).toBe("fully_released");
    expect(await getAssetBalance(grantee, asset.id)).toBe(4800n);
  });

  it("exercises vested options: pays the price, receives units, gates on vested amount", async () => {
    const { createGrant, exercise } = await import("../src/services/equityCompService");
    const { getAssetBalance, getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const company = await makeUser();
    const asset = await makeEquityAsset(10_000n, company);
    const grantee = await makeUser(); // $10,000 opening balance
    const grant = await createGrant({
      assetId: asset.id, recipientUserId: grantee, grantorUserId: company, awardType: "option",
      unitsTotal: 1000n, exercisePriceMinor: 100n, // $1.00 / unit
      vestStart: iso(2020, 1, 1), cliffMonths: 12, durationMonths: 48,
    });
    // Before cliff → nothing exercisable.
    await expect(exercise({ grantId: grant.id, qty: 10n, idempotencyKey: "x0", asOf: new Date(iso(2020, 6, 1)) })).rejects.toThrow();
    // At 1yr, 250 vested; exercise 100 for $100.
    const ex = await exercise({ grantId: grant.id, qty: 100n, idempotencyKey: "x1", asOf: new Date(iso(2021, 1, 1)) });
    expect(ex.unitsReleased).toBe(100n);
    expect(await getAssetBalance(grantee, asset.id)).toBe(100n);
    const cash = await getOrCreateUserAccount(grantee, "user_cash", "USD");
    expect(await getBalance(cash)).toBe(990000n); // $10,000 - $100 = $9,900.00
    // Over-exercise beyond vested → rejected.
    await expect(exercise({ grantId: grant.id, qty: 100000n, idempotencyKey: "x2", asOf: new Date(iso(2021, 1, 1)) })).rejects.toThrow();
  });

  it("tracks 83(b), caps the pool, and reports a cap table", async () => {
    const { createGrant, mark83bFiled, capTable } = await import("../src/services/equityCompService");
    const company = await makeUser();
    const asset = await makeEquityAsset(1000n, company);
    const a = await makeUser();
    const b = await makeUser();

    const g = await createGrant({ assetId: asset.id, recipientUserId: a, awardType: "unit_award", unitsTotal: 600n, vestStart: iso(2020, 1, 1) });
    expect(g.eightyThreeBFiled).toBe(false);
    const filed = await mark83bFiled(g.id);
    expect(filed.eightyThreeBFiled).toBe(true);

    // Pool is 1000; 600 granted → only 400 left. A 500-unit grant is rejected.
    await expect(createGrant({ assetId: asset.id, recipientUserId: b, awardType: "unit_award", unitsTotal: 500n })).rejects.toThrow();
    await createGrant({ assetId: asset.id, recipientUserId: b, awardType: "unit_award", unitsTotal: 400n });

    const ct = await capTable(asset.id);
    expect(ct.totalSupply).toBe("1000");
    expect(ct.totalGranted).toBe("1000");
    expect(ct.unallocated).toBe("0");
    expect(ct.grants.length).toBe(2);
  });
});

describe("equity comp — kill-switch", () => {
  it("refuses to grant when disabled", async () => {
    const { config } = await import("../src/config");
    const { createGrant } = await import("../src/services/equityCompService");
    const asset = await makeEquityAsset(100n);
    const grantee = await makeUser();
    (config as { EQUITY_COMP_ENABLED: boolean }).EQUITY_COMP_ENABLED = false;
    await expect(createGrant({ assetId: asset.id, recipientUserId: grantee, awardType: "unit_award", unitsTotal: 10n })).rejects.toThrow();
    (config as { EQUITY_COMP_ENABLED: boolean }).EQUITY_COMP_ENABLED = true;
  });
});
