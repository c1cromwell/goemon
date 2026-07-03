/**
 * Phase 29 — first onboarded vertical: real estate.
 *
 * Proves the master-plan thesis: a new asset class costs an `assetTypeRegistry` entry +
 * metadata, NOT engine changes. The SAME issuance / compliance / capital-raise / secondary-market
 * services (P1/P2/P5/P6) work on a `real_estate` asset with zero new code.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-realestate-${Date.now()}.db`;

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
  (config as Record<string, boolean>).ISSUANCE_CONSOLE_ENABLED = true;
  (config as Record<string, boolean>).CAPITAL_RAISE_ENABLED = true;
  (config as Record<string, boolean>).SECONDARY_MARKET_ENABLED = true;
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
  const u = await createUser(`re-${seq++}-${Date.now()}@test.com`, "User");
  await getOrCreateUserAccount(u.id, "user_cash", "USD");
  await getDb().execute("UPDATE identity_profiles SET tier = ?, jurisdiction = ? WHERE user_id = ?", [tier, jur, u.id]);
  return u.id;
}
const key = () => `k-${seq++}-${Math.random().toString(36).slice(2)}`;

describe("real-estate vertical", () => {
  it("is a registered, security asset type with a real-estate default", async () => {
    const { getAssetType, isKnownAssetKind, isSecurityKind, listAssetTypes } = await import("../src/services/assetTypeRegistry");
    expect(isKnownAssetKind("real_estate")).toBe(true);
    expect(getAssetType("real_estate")?.label).toBe("Real estate");
    expect(isSecurityKind("real_estate", "erc3643")).toBe(true);
    expect(listAssetTypes().some((t) => t.kind === "real_estate")).toBe(true);
  });

  it("issues via the console with property metadata; compliance gates it as a security", async () => {
    const { issueAsset } = await import("../src/services/issuanceService");
    const { checkTransfer } = await import("../src/services/complianceService");
    const { getAsset } = await import("../src/services/tokenizationService");
    const issuer = await makeUser();
    const res = await issueAsset({
      issuerUserId: issuer, kind: "real_estate", name: "The Maple Apartments", symbol: "APTS",
      minTier: 2, jurisdictionAllow: ["US"], holderCap: 199, initialSupply: 10_000n,
      metadata: { propertyType: "apartment", address: "123 Maple St", valuationMinor: "620000000" },
      listing: { surface: "invest", priceMinor: 25_000n },
    });
    expect(res.asset.kind).toBe("real_estate");
    expect(res.asset.isSecurity).toBe(true);
    expect(res.asset.metadata.propertyType).toBe("apartment");
    expect(res.listed).toBe(true);

    const asset = (await getAsset(res.asset.id))!;
    // A Tier-1 / non-US buyer is blocked by the security compliance profile.
    const ineligible = await makeUser(1, "CA");
    expect((await checkTransfer(asset, ineligible)).allowed).toBe(false);
    const eligible = await makeUser(2, "US");
    expect((await checkTransfer(asset, eligible)).allowed).toBe(true);
  });

  it("flows through capital raise (P5) and the secondary market (P6) unchanged", async () => {
    const issuance = await import("../src/services/issuanceService");
    const raise = await import("../src/services/capitalRaiseService");
    const market = await import("../src/services/secondaryMarketService");
    const { getAssetBalance } = await import("../src/services/ledgerService");

    const issuer = await makeUser();
    const asset = (await issuance.issueAsset({
      issuerUserId: issuer, kind: "real_estate", name: "Kerr County Land", symbol: "LAND",
      minTier: 0, initialSupply: 10_000n, metadata: { propertyType: "land" },
    })).asset;

    // Raise: $50/unit, target $500, cap $5000. Two investors settle it.
    const o = await raise.openOffering({ assetId: asset.id, issuerUserId: issuer, exemption: "reg_cf", priceMinor: 5000n, targetMinor: 50000n, capMinor: 500000n });
    const a = await makeUser(); const b = await makeUser();
    await raise.invest({ offeringId: o.id, investorUserId: a, units: 6n, idempotencyKey: key() });  // $300
    await raise.invest({ offeringId: o.id, investorUserId: b, units: 5n, idempotencyKey: key() });  // $250 → $550 ≥ target
    const closed = await raise.closeOffering(o.id);
    expect(closed.status).toBe("settled");
    expect(await getAssetBalance(a, asset.id)).toBe(6n);

    // Secondary: investor A sells 2 units, another buyer takes them.
    await market.placeOrder({ assetId: asset.id, userId: a, side: "sell", qty: 2n, limitPriceMinor: 6000n, idempotencyKey: key() });
    const buyer = await makeUser();
    const buy = await market.placeOrder({ assetId: asset.id, userId: buyer, side: "buy", qty: 2n, limitPriceMinor: 6000n, idempotencyKey: key() });
    expect(buy.fills.length).toBe(1);
    expect(await getAssetBalance(buyer, asset.id)).toBe(2n);
    expect(await getAssetBalance(a, asset.id)).toBe(4n); // 6 - 2 sold
  });
});
