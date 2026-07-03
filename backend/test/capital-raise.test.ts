/**
 * Phase 29 P5 — capital formation / primary raises.
 *
 * Covers the escrow lifecycle: commit funds → settle (deliver units + pay issuer) when the
 * target is met, refund when it isn't, per-investor caps, the cap ceiling, the Reg D 506(c)
 * accreditation gate, and the kill-switch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-raise-${Date.now()}.db`;

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
  (config as { CAPITAL_RAISE_ENABLED: boolean }).CAPITAL_RAISE_ENABLED = true;
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
  const u = await createUser(`raise-${seq++}-${Date.now()}@test.com`, "Investor");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening balance
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}
async function makeSecurity(supply: bigint, issuer: string) {
  const { createAsset } = await import("../src/services/tokenizationService");
  return createAsset({ kind: "security", tokenStandard: "erc3643", name: "RaiseCo Units", symbol: "RAISE", issuerUserId: issuer, minTier: 0, initialSupply: supply });
}
const key = () => `k-${seq++}-${Math.random().toString(36).slice(2)}`;
async function cash(userId: string) {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("capital raise — settle path", () => {
  it("commits to escrow then settles: units delivered, issuer paid", async () => {
    const svc = await import("../src/services/capitalRaiseService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const issuer = await makeUser();
    const asset = await makeSecurity(10_000n, issuer);
    // price $10/unit, target $500 (50 units), cap $2000 (200 units).
    const o = await svc.openOffering({ assetId: asset.id, issuerUserId: issuer, exemption: "reg_cf", priceMinor: 1000n, targetMinor: 50000n, capMinor: 200000n });

    const a = await makeUser(); const b = await makeUser();
    await svc.invest({ offeringId: o.id, investorUserId: a, units: 30n, idempotencyKey: key() }); // $300
    await svc.invest({ offeringId: o.id, investorUserId: b, units: 40n, idempotencyKey: key() }); // $400 → total $700 ≥ target
    const prog = await svc.offeringProgress(o.id);
    expect(prog.raisedMinor).toBe("70000");
    expect(prog.investorCount).toBe(2);
    // funds are escrowed (out of investor cash): a paid $300.
    expect(await cash(a)).toBe(970000n); // $10,000 - $300

    const result = await svc.closeOffering(o.id);
    expect(result.status).toBe("settled");
    expect(result.settled).toBe(2);
    // units delivered, issuer received the proceeds.
    expect(await getAssetBalance(a, asset.id)).toBe(30n);
    expect(await getAssetBalance(b, asset.id)).toBe(40n);
    expect(await cash(issuer)).toBe(1070000n); // $10,000 opening + $700 raised
  });
});

describe("capital raise — refund path & limits", () => {
  it("refunds everyone when the target isn't met", async () => {
    const svc = await import("../src/services/capitalRaiseService");
    const issuer = await makeUser();
    const asset = await makeSecurity(10_000n, issuer);
    const o = await svc.openOffering({ assetId: asset.id, issuerUserId: issuer, exemption: "reg_cf", priceMinor: 1000n, targetMinor: 100000n, capMinor: 200000n }); // target $1000
    const a = await makeUser();
    await svc.invest({ offeringId: o.id, investorUserId: a, units: 10n, idempotencyKey: key() }); // $100 < target
    expect(await cash(a)).toBe(990000n);
    const result = await svc.closeOffering(o.id);
    expect(result.status).toBe("refunded");
    expect(await cash(a)).toBe(1000000n); // fully refunded
  });

  it("enforces the per-investor max and the offering cap", async () => {
    const svc = await import("../src/services/capitalRaiseService");
    const issuer = await makeUser();
    const asset = await makeSecurity(10_000n, issuer);
    const o = await svc.openOffering({
      assetId: asset.id, issuerUserId: issuer, exemption: "reg_cf", priceMinor: 1000n,
      targetMinor: 10000n, capMinor: 50000n, maxInvestmentMinor: 20000n, // max $200/investor, cap $500
    });
    const a = await makeUser();
    await svc.invest({ offeringId: o.id, investorUserId: a, units: 15n, idempotencyKey: key() }); // $150 ok
    await expect(svc.invest({ offeringId: o.id, investorUserId: a, units: 10n, idempotencyKey: key() })).rejects.toThrow(); // +$100 > $200 max
    // Fill toward the cap with other investors, then over-cap is blocked.
    for (const _ of [1, 2, 3]) await svc.invest({ offeringId: o.id, investorUserId: await makeUser(), units: 10n, idempotencyKey: key() }); // +$300 → $450
    await expect(svc.invest({ offeringId: o.id, investorUserId: await makeUser(), units: 10n, idempotencyKey: key() })).rejects.toThrow(); // +$100 > $500 cap
  });
});

describe("capital raise — Reg D accreditation gate & kill-switch", () => {
  it("Reg D 506(c) blocks non-accredited, allows accredited", async () => {
    const svc = await import("../src/services/capitalRaiseService");
    const { setAccreditation } = await import("../src/services/identityService");
    const issuer = await makeUser();
    const asset = await makeSecurity(10_000n, issuer);
    const o = await svc.openOffering({ assetId: asset.id, issuerUserId: issuer, exemption: "reg_d_506c", priceMinor: 1000n, targetMinor: 10000n, capMinor: 100000n });
    const investor = await makeUser();
    await expect(svc.invest({ offeringId: o.id, investorUserId: investor, units: 10n, idempotencyKey: key() })).rejects.toThrow();
    await setAccreditation(investor, true);
    const inv = await svc.invest({ offeringId: o.id, investorUserId: investor, units: 10n, idempotencyKey: key() });
    expect(inv.status).toBe("committed");
  });

  it("refuses when the kill-switch is off", async () => {
    const { config } = await import("../src/config");
    const svc = await import("../src/services/capitalRaiseService");
    const issuer = await makeUser();
    const asset = await makeSecurity(100n, issuer);
    (config as { CAPITAL_RAISE_ENABLED: boolean }).CAPITAL_RAISE_ENABLED = false;
    await expect(svc.openOffering({ assetId: asset.id, issuerUserId: issuer, exemption: "reg_cf", priceMinor: 1000n, targetMinor: 1000n, capMinor: 2000n })).rejects.toThrow();
    (config as { CAPITAL_RAISE_ENABLED: boolean }).CAPITAL_RAISE_ENABLED = true;
  });
});
