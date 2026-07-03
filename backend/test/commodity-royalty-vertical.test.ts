/**
 * Phase 29 verticals — commodities + IP royalties.
 *
 * commodity — a non-security good: freely tradeable (tier-only), trades on the P6 order book
 *   with no jurisdiction/holder gate.
 * royalty   — an income-producing security: compliance-gated AND supports pro-rata royalty
 *   distributions via corporate actions (like a dividend), landing in the P3 holder cockpit.
 * Both are just registry entries — no engine changes.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-verticals-${Date.now()}.db`;

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
  (config as Record<string, boolean>).SECONDARY_MARKET_ENABLED = true;
  (config as Record<string, boolean>).EQUITIES_ENABLED = true; // enables the corporate-actions engine
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  const fs = require("fs");
  for (const s of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + s); } catch { /* ignore */ } }
});

let seq = 0;
async function makeUser(tier = 2, jur = "US"): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`v-${seq++}-${Date.now()}@test.com`, "User");
  await getOrCreateUserAccount(u.id, "user_cash", "USD");
  await getDb().execute("UPDATE identity_profiles SET tier = ?, jurisdiction = ? WHERE user_id = ?", [tier, jur, u.id]);
  return u.id;
}
async function grantUnits(userId: string, assetId: string, qty: bigint) {
  const { postJournal, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, assetLedgerCode } = await import("../src/services/ledgerService");
  const code = assetLedgerCode(assetId);
  const t = await getOrCreateAssetTreasury(assetId);
  const h = await getOrCreateUserAssetAccount(userId, assetId);
  await postJournal([{ ledgerAccountId: t, direction: "debit", amountMinor: qty, currency: code }, { ledgerAccountId: h, direction: "credit", amountMinor: qty, currency: code }], "grant", { idempotencyKey: `grant:${assetId}:${userId}` });
}
const key = () => `k-${seq++}-${Math.random().toString(36).slice(2)}`;

describe("commodity + royalty verticals", () => {
  it("registers both; commodity is exempt/tradeable, royalty is a distributing security", async () => {
    const { getAssetType, isSecurityKind, assetKindDistributes, listAssetTypes } = await import("../src/services/assetTypeRegistry");
    expect(getAssetType("commodity")?.label).toBe("Commodity");
    expect(getAssetType("royalty")?.label).toBe("IP royalty");
    expect(isSecurityKind("commodity", "hts")).toBe(false);
    expect(isSecurityKind("royalty", "erc3643")).toBe(true);
    expect(assetKindDistributes("commodity")).toBe(false);
    expect(assetKindDistributes("royalty")).toBe(true);
    expect(assetKindDistributes("real_estate")).toBe(true);
    expect(listAssetTypes().map((t) => t.kind).sort()).toEqual(["collectible", "commodity", "equity", "gaming", "real_estate", "royalty", "security", "treasury"]);
  });

  it("commodity trades freely on the secondary market (no securities gate)", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const market = await import("../src/services/secondaryMarketService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const seller = await makeUser();
    const gold = await createAsset({ kind: "commodity", tokenStandard: "hts", name: "Gold 1oz", symbol: "GOLD", minTier: 0, initialSupply: 1000n });
    await grantUnits(seller, gold.id, 100n);
    await market.placeOrder({ assetId: gold.id, userId: seller, side: "sell", qty: 10n, limitPriceMinor: 5000n, idempotencyKey: key() });
    // A Tier-0 buyer (no accreditation/jurisdiction) can buy a commodity.
    const buyer = await makeUser(0, "CA");
    const b = await market.placeOrder({ assetId: gold.id, userId: buyer, side: "buy", qty: 10n, limitPriceMinor: 5000n, idempotencyKey: key() });
    expect(b.fills.length).toBe(1);
    expect(await getAssetBalance(buyer, gold.id)).toBe(10n);
  });

  it("royalty distributes a pro-rata payout to holders (P3 cockpit)", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const { declareCorporateAction, distributeDividend } = await import("../src/services/corporateActionService");
    const { getDistributions } = await import("../src/services/portfolioService");
    const holder = await makeUser();
    const song = await createAsset({ kind: "royalty", tokenStandard: "erc3643", name: "Midnight Roads", symbol: "MUSIC1", minTier: 0, initialSupply: 1000n });
    await grantUnits(holder, song.id, 50n);
    // Royalty payout of $0.20 / unit → holder receives $10.00.
    const ca = await declareCorporateAction({ assetId: song.id, type: "dividend", amountPerUnitMinor: 20n, currency: "USD" });
    await distributeDividend(ca.id);
    const dists = await getDistributions(holder);
    expect(dists.length).toBe(1);
    expect(dists[0]!.label).toBe("MUSIC1");
    expect(dists[0]!.amountMinor).toBe("1000"); // 50 × $0.20
  });
});
