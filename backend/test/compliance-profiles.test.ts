/**
 * Phase 29 Slice 2 — compliance-profile registry.
 *
 * Two goals:
 *   A. ZERO BEHAVIOR CHANGE — the refactored checkTransfer still gates exactly as
 *      before: collectibles transfer freely (identity + tier), securities enforce
 *      tier + jurisdiction + holder-cap.
 *   B. EXTENSIBILITY — an asset opts into a richer profile via metadata
 *      (`complianceProfile: "security-whitelisted"`) and a NEW composable dimension
 *      (whitelist) blocks a non-listed recipient — no schema migration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-compliance-profiles-${Date.now()}.db`;

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
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

let seq = 0;
async function makeUser(tier = 2, jurisdiction = "US"): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const u = await createUser(`comp-${seq++}-${Date.now()}@test.com`, "Comp User");
  await getDb().execute("UPDATE identity_profiles SET tier = ?, jurisdiction = ? WHERE user_id = ?", [tier, jurisdiction, u.id]);
  return u.id;
}

async function check(assetId: string, toUserId: string) {
  const { getAsset } = await import("../src/services/tokenizationService");
  const { checkTransfer } = await import("../src/services/complianceService");
  const asset = (await getAsset(assetId))!;
  return checkTransfer(asset, toUserId);
}

describe("compliance profiles — behavior unchanged (exempt + security)", () => {
  it("collectible (exempt-basic): identity + tier only", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const asset = await createAsset({ kind: "collectible", tokenStandard: "hts", name: "Card", minTier: 1, initialSupply: 5n });

    const eligible = await makeUser(2, "US");
    expect((await check(asset.id, eligible)).allowed).toBe(true);

    const lowTier = await makeUser(0, "US");
    expect((await check(asset.id, lowTier)).allowed).toBe(false);

    // An unknown recipient is not on the identity registry.
    const unregistered = uuidv4();
    const res = await check(asset.id, unregistered);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/identity registry/i);
  });

  it("security (security-erc3643): tier + jurisdiction + holder-cap", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const asset = await createAsset({
      kind: "security", tokenStandard: "erc3643", name: "MAPLE-DEMO",
      minTier: 2, jurisdictionAllow: ["US"], holderCap: 1, initialSupply: 100n,
    });

    // Wrong jurisdiction → blocked.
    const nonUS = await makeUser(2, "CA");
    expect((await check(asset.id, nonUS)).allowed).toBe(false);

    // Below tier → blocked.
    const lowTier = await makeUser(1, "US");
    expect((await check(asset.id, lowTier)).allowed).toBe(false);

    // Eligible US Tier-2 → allowed (no holder yet).
    const ok = await makeUser(2, "US");
    expect((await check(asset.id, ok)).allowed).toBe(true);

    // Simulate the asset reaching its holder cap of 1, then a NEW holder is blocked.
    const { postJournal, getOrCreateUserAssetAccount, getOrCreateAssetTreasury, assetLedgerCode } =
      await import("../src/services/ledgerService");
    const holder = await makeUser(2, "US");
    const code = assetLedgerCode(asset.id);
    const treasury = await getOrCreateAssetTreasury(asset.id);
    const holderAcct = await getOrCreateUserAssetAccount(holder, asset.id);
    await postJournal(
      [
        { ledgerAccountId: treasury, direction: "debit", amountMinor: 1n, currency: code },
        { ledgerAccountId: holderAcct, direction: "credit", amountMinor: 1n, currency: code },
      ],
      "test: seed one holder to reach cap",
      { idempotencyKey: `test:cap:${asset.id}` }
    );
    // Cap (1) now reached: a brand-new recipient is blocked...
    const newRecipient = await makeUser(2, "US");
    const capped = await check(asset.id, newRecipient);
    expect(capped.allowed).toBe(false);
    expect(capped.reason).toMatch(/holder cap/i);
    // ...but the existing holder can still receive more.
    expect((await check(asset.id, holder)).allowed).toBe(true);
  });
});

describe("compliance profiles — extensibility (opt-in whitelist dimension)", () => {
  it("security-whitelisted (via metadata) blocks a non-listed recipient", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const alice = await makeUser(2, "US");
    const bob = await makeUser(2, "US");

    const asset = await createAsset({
      kind: "security", tokenStandard: "erc3643", name: "PRIVATE-PLACEMENT",
      minTier: 0, jurisdictionAllow: [], initialSupply: 100n,
      metadata: { complianceProfile: "security-whitelisted", whitelist: [alice] },
    });

    // Alice is whitelisted → allowed; Bob passes tier/jurisdiction but fails the whitelist.
    expect((await check(asset.id, alice)).allowed).toBe(true);
    const bobRes = await check(asset.id, bob);
    expect(bobRes.allowed).toBe(false);
    expect(bobRes.reason).toMatch(/whitelist/i);
  });

  it("security-accredited gates on the real accredited flag (P2 depth)", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const { setAccreditation } = await import("../src/services/identityService");
    const user = await makeUser(2, "US");

    const asset = await createAsset({
      kind: "security", tokenStandard: "erc3643", name: "Accredited Only", symbol: "ACCR",
      minTier: 0, jurisdictionAllow: [], initialSupply: 100n,
      metadata: { complianceProfile: "security-accredited" },
    });

    // Not accredited by default → blocked.
    const before = await check(asset.id, user);
    expect(before.allowed).toBe(false);
    expect(before.reason).toMatch(/accredited/i);

    // Compliance marks the user accredited → now allowed.
    await setAccreditation(user, true);
    expect((await check(asset.id, user)).allowed).toBe(true);

    // Revoking accreditation blocks again.
    await setAccreditation(user, false);
    expect((await check(asset.id, user)).allowed).toBe(false);
  });
});
