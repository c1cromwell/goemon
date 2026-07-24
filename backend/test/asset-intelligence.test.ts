/**
 * Phase 30 — asset intelligence: watchlist, views, composed metrics, cost-basis P&L,
 * and collectible intel (population + provenance value history).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-assetintel-${Date.now()}.db`;

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
  for (const s of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TMP_DB + s);
    } catch {
      /* ignore */
    }
  }
});

let seq = 0;
async function makeUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`ai-${seq++}-${Date.now()}@test.com`, "Investor");
  await getOrCreateUserAccount(u.id, "user_cash", "USD");
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}

async function makeAssetHeldBy(holder: string, units: bigint, kind = "equity") {
  const { createAsset } = await import("../src/services/tokenizationService");
  const { postJournal, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, assetLedgerCode } = await import(
    "../src/services/ledgerService"
  );
  const asset = await createAsset({
    kind: kind as "equity",
    tokenStandard: "hts",
    name: "Metric Co",
    symbol: "MTR",
    minTier: 0,
    initialSupply: units * 2n,
    metadata: { apyBps: 500 },
  });
  const code = assetLedgerCode(asset.id);
  const t = await getOrCreateAssetTreasury(asset.id);
  const h = await getOrCreateUserAssetAccount(holder, asset.id);
  await postJournal(
    [
      { ledgerAccountId: t, direction: "debit", amountMinor: units, currency: code },
      { ledgerAccountId: h, direction: "credit", amountMinor: units, currency: code },
    ],
    "seed holding",
    { idempotencyKey: `seed:${asset.id}:${holder}` }
  );
  return asset.id;
}

describe("watchlist", () => {
  it("adds, is idempotent, counts distinct savers, and removes", async () => {
    const wl = await import("../src/services/watchlistService");
    const a = await makeUser();
    const b = await makeUser();
    const asset = await makeAssetHeldBy(a, 100n);

    await wl.add(a, asset);
    await wl.add(a, asset); // idempotent
    await wl.add(b, asset);
    expect(await wl.countForAsset(asset)).toBe(2);
    expect(await wl.isWatched(a, asset)).toBe(true);
    expect(await wl.listAssetIds(a)).toContain(asset);

    await wl.remove(a, asset);
    expect(await wl.isWatched(a, asset)).toBe(false);
    expect(await wl.countForAsset(asset)).toBe(1);
  });
});

describe("views", () => {
  it("counts distinct viewers (repeat views don't double-count)", async () => {
    const views = await import("../src/services/assetViewService");
    const a = await makeUser();
    const b = await makeUser();
    const asset = await makeAssetHeldBy(a, 50n);

    await views.recordView(a, asset);
    await views.recordView(a, asset); // same user again
    await views.recordView(b, asset);
    expect(await views.distinctViewers(asset)).toBe(2);
  });
});

describe("asset metrics", () => {
  it("composes investors, price change, valuation label, and trade stats", async () => {
    const metricsSvc = await import("../src/services/assetMetricsService");
    const listing = await import("../src/services/listingService");
    const holder = await makeUser();
    const asset = await makeAssetHeldBy(holder, 100n);

    // Two listing versions → a price change.
    await listing.createListing({ assetId: asset, surface: "invest", priceMinor: 1000n, priceSource: "issuer", reviewer: "admin" });
    await listing.updatePrice(asset, 1100n, "issuer", "admin");

    const m = await metricsSvc.getMetrics(asset, holder);
    expect(m).not.toBeNull();
    expect(m!.investorCount).toBe(1);
    expect(m!.priceMinor).toBe("1100");
    expect(m!.priceChangeBps).toBe(1000); // (1100-1000)/1000 = +10%
    expect(m!.valuation).not.toBeNull();
    expect(["premium", "discount", "near_reference"]).toContain(m!.valuation!.label);
    expect(m!.yield.apyBps).toBe(500);
    expect(m!.tradeStats.buyCount).toBeGreaterThanOrEqual(0);
  });

  it("derives cost basis + unrealized P&L from a recorded buy fill", async () => {
    const metricsSvc = await import("../src/services/assetMetricsService");
    const listing = await import("../src/services/listingService");
    const { getDb } = await import("../src/db");
    const { v4: uuidv4 } = await import("uuid");
    const holder = await makeUser();
    const asset = await makeAssetHeldBy(holder, 100n);
    await listing.createListing({ assetId: asset, surface: "invest", priceMinor: 200n, priceSource: "issuer", reviewer: "admin" });

    // Record a buy of 100 units @ $1 (gross 10000) so avg cost = 100/unit; price now 200/unit → +100%.
    await getDb().execute(
      `INSERT INTO orders (id, asset_id, user_id, side, qty_base, price_minor, currency, gross_minor, fee_minor, net_minor, status, idempotency_key, created_at)
       VALUES (?, ?, ?, 'buy', 100, 100, 'USD', 10000, 0, 10000, 'filled', ?, ?)`,
      [uuidv4(), asset, holder, uuidv4(), new Date().toISOString()]
    );

    const m = await metricsSvc.getMetrics(asset, holder);
    expect(m!.position).not.toBeNull();
    expect(m!.position!.costBasis.avgCostPerUnitMinor).toBe("100");
    // held 100 @ market 200 = 20000; basis 10000 → +10000 (+100% = 10000 bps)
    expect(m!.position!.costBasis.unrealizedPnlMinor).toBe("10000");
    expect(m!.position!.costBasis.unrealizedPnlBps).toBe(10000);
    expect(m!.tradeStats.buyCount).toBe(1);
  });
});

describe("collectible intel", () => {
  it("returns population, facts, and seeds a value-history provenance series", async () => {
    const intel = await import("../src/services/collectibleIntelService");
    const { getAsset } = await import("../src/services/tokenizationService");
    const holder = await makeUser();
    const assetId = await makeAssetHeldBy(holder, 1n, "collectible");
    const asset = (await getAsset(assetId))!;

    const first = await intel.getIntel(asset, 500_00n);
    expect(first.provenance.length).toBeGreaterThan(0);
    expect(first.tradeHistory.timesSold).toBeGreaterThan(0);

    // Idempotent seeding: a second call doesn't duplicate the provenance history.
    const second = await intel.getIntel(asset, 500_00n);
    expect(second.provenance.length).toBe(first.provenance.length);
  });
});
