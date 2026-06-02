/**
 * Phase 8 — Tokenized RWA & Marketplace invariants.
 *
 * Verifies the money-and-asset-critical behaviors:
 *   1. Atomic settlement — a buy moves cash AND asset AND fee in one journal.
 *   2. Asset quantity is integer base units (bigint); fractional/zero is rejected.
 *   3. Compliance-on-transfer — a securities transfer to an ineligible recipient
 *      is rejected with COMPLIANCE_BLOCKED.
 *   4. Escrow refund — a cancelled subscription returns the escrowed cash.
 *   5. Idempotent orders — the same Idempotency-Key settles exactly once.
 *   6. Tier + jurisdiction gating on securities.
 *   7. Listing records are versioned + insert-only (history preserved).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-phase8-${Date.now()}.db`;

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

// --- helpers ---------------------------------------------------------------

let seq = 0;
async function makeUser(tier = 2, jurisdiction = "US"): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`mkt-${seq++}-${Date.now()}@test.com`, "Mkt User");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // seeds $10,000 opening balance
  await getDb().execute("UPDATE identity_profiles SET tier = ?, jurisdiction = ? WHERE user_id = ?", [tier, jurisdiction, u.id]);
  return u.id;
}

async function createCollectible(priceMinor: bigint, supply: bigint) {
  const { createAsset } = await import("../src/services/tokenizationService");
  const { createListing, transitionListing } = await import("../src/services/listingService");
  const asset = await createAsset({ kind: "collectible", tokenStandard: "hts", name: "PSA-10 Card", minTier: 0, initialSupply: supply });
  await createListing({ assetId: asset.id, surface: "collect", priceMinor, priceSource: "orderbook", reviewer: "test-admin" });
  await transitionListing(asset.id, "soft", "test-admin");
  return asset.id;
}

async function createSecurity(priceMinor: bigint, supply: bigint, opts: { minTier?: number; holderCap?: number; jurisdictionAllow?: string[] } = {}) {
  const { createAsset } = await import("../src/services/tokenizationService");
  const { createListing, transitionListing } = await import("../src/services/listingService");
  const asset = await createAsset({
    kind: "security",
    tokenStandard: "erc3643",
    name: "Maple St. Building LLC",
    minTier: opts.minTier ?? 2,
    holderCap: opts.holderCap,
    jurisdictionAllow: opts.jurisdictionAllow ?? [],
    initialSupply: supply,
  });
  await createListing({ assetId: asset.id, surface: "invest", priceMinor, priceSource: "nav", reviewer: "test-admin" });
  await transitionListing(asset.id, "soft", "test-admin");
  return asset.id;
}

// --- tests -----------------------------------------------------------------

describe("Phase 8: atomic settlement", () => {
  it("a buy moves cash, asset, and fee in one balanced journal", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const { getAssetBalance, getBalance, getSystemAccount, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const { treasuryAvailable } = await import("../src/services/tokenizationService");

    const userId = await makeUser(2);
    const assetId = await createCollectible(10_000n, 5n); // $100 each, 5 in inventory

    const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const feeId = await getSystemAccount("fee", "USD");
    const cashBefore = await getBalance(cashId);
    const feeBefore = await getBalance(feeId);

    const order = await placeOrder(userId, assetId, "buy", 2n, uuidv4());

    // gross = 2 * 10000 = 20000; fee = 0.5% = 100; net = 20100.
    expect(order.grossMinor).toBe("20000");
    expect(order.feeMinor).toBe("100");
    expect(order.netMinor).toBe("20100");

    expect(await getAssetBalance(userId, assetId)).toBe(2n);
    expect(await treasuryAvailable(assetId)).toBe(3n);
    expect(cashBefore - (await getBalance(cashId))).toBe(20_100n); // cash debited by net
    expect((await getBalance(feeId)) - feeBefore).toBe(100n); // fee credited
  });
});

describe("Phase 8: asset quantity is integer base units", () => {
  it("getAssetBalance returns bigint and zero/negative quantity is rejected", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const userId = await makeUser(2);
    const assetId = await createCollectible(5_000n, 3n);

    const bal = await getAssetBalance(userId, assetId);
    expect(typeof bal).toBe("bigint");
    await expect(placeOrder(userId, assetId, "buy", 0n, uuidv4())).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });
});

describe("Phase 8: compliance-on-transfer", () => {
  it("rejects a securities transfer to an ineligible recipient (COMPLIANCE_BLOCKED)", async () => {
    const { placeOrder, transferAsset } = await import("../src/services/marketplaceService");
    const holder = await makeUser(2, "US");
    const recipientLowTier = await makeUser(1, "US");
    const assetId = await createSecurity(5_000n, 100n, { minTier: 2 });

    await placeOrder(holder, assetId, "buy", 3n, uuidv4()); // tier-2 buyer is eligible
    await expect(transferAsset(holder, recipientLowTier, assetId, 1n, uuidv4())).rejects.toMatchObject({
      code: ErrorCode.COMPLIANCE_BLOCKED,
    });
  });

  it("allows a securities transfer to an eligible recipient", async () => {
    const { placeOrder, transferAsset } = await import("../src/services/marketplaceService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const holder = await makeUser(2, "US");
    const recipient = await makeUser(2, "US");
    const assetId = await createSecurity(5_000n, 100n, { minTier: 2 });

    await placeOrder(holder, assetId, "buy", 3n, uuidv4());
    await transferAsset(holder, recipient, assetId, 1n, uuidv4());
    expect(await getAssetBalance(recipient, assetId)).toBe(1n);
    expect(await getAssetBalance(holder, assetId)).toBe(2n);
  });
});

describe("Phase 8: subscription escrow", () => {
  it("refunds escrowed cash when a subscription is cancelled", async () => {
    const { subscribe, refundSubscription } = await import("../src/services/marketplaceService");
    const { getBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const userId = await makeUser(2);
    const assetId = await createSecurity(10_000n, 50n, { minTier: 2 });

    const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const cashBefore = await getBalance(cashId);

    const order = await subscribe(userId, assetId, 2n, uuidv4());
    expect(order.status).toBe("open");
    // gross 20000 + fee (1% = 200) = 20200 escrowed out of cash.
    expect(cashBefore - (await getBalance(cashId))).toBe(20_200n);

    await refundSubscription(order.orderId);
    expect(await getBalance(cashId)).toBe(cashBefore); // fully restored
  });

  it("closes a subscription: distributes the asset and releases escrow", async () => {
    const { subscribe, closeSubscription } = await import("../src/services/marketplaceService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const userId = await makeUser(2);
    const assetId = await createSecurity(10_000n, 50n, { minTier: 2 });

    const order = await subscribe(userId, assetId, 4n, uuidv4());
    await closeSubscription(order.orderId);
    expect(await getAssetBalance(userId, assetId)).toBe(4n);
  });
});

describe("Phase 8: idempotent orders", () => {
  it("settles exactly once for a repeated Idempotency-Key", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const { getBalance, getAssetBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const userId = await makeUser(2);
    const assetId = await createCollectible(10_000n, 10n);
    const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const cashBefore = await getBalance(cashId);
    const key = uuidv4();

    const first = await placeOrder(userId, assetId, "buy", 2n, key);
    const second = await placeOrder(userId, assetId, "buy", 2n, key);

    expect(second.orderId).toBe(first.orderId);
    expect(await getAssetBalance(userId, assetId)).toBe(2n); // not 4
    expect(cashBefore - (await getBalance(cashId))).toBe(20_100n); // charged once
  });
});

describe("Phase 8: tier + jurisdiction gating", () => {
  it("blocks a sub-tier buyer of a security", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const lowTier = await makeUser(1, "US");
    const assetId = await createSecurity(5_000n, 100n, { minTier: 2 });
    await expect(placeOrder(lowTier, assetId, "buy", 1n, uuidv4())).rejects.toMatchObject({ code: ErrorCode.COMPLIANCE_BLOCKED });
  });

  it("blocks a buyer in a disallowed jurisdiction", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const offshore = await makeUser(2, "CA");
    const assetId = await createSecurity(5_000n, 100n, { minTier: 2, jurisdictionAllow: ["US"] });
    await expect(placeOrder(offshore, assetId, "buy", 1n, uuidv4())).rejects.toMatchObject({ code: ErrorCode.COMPLIANCE_BLOCKED });
  });
});

describe("Phase 8: listings are versioned and insert-only", () => {
  it("each lifecycle change appends a new version; history is preserved", async () => {
    const { getCurrentListing, transitionListing } = await import("../src/services/listingService");
    const { getDb } = await import("../src/db");
    const assetId = await createCollectible(7_500n, 4n); // create (v1 staging) + transition (v2 soft)
    await transitionListing(assetId, "public", "test-admin"); // v3

    const rows = await getDb().query<{ version: number; status: string }>(
      "SELECT version, status FROM listings WHERE asset_id = ? ORDER BY version",
      [assetId]
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.status)).toEqual(["staging", "soft", "public"]);
    expect((await getCurrentListing(assetId))!.status).toBe("public");
  });
});
