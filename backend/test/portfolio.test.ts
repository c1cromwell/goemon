/**
 * Phase 29 P3 — holder portfolio / investment-management tools.
 *
 * Sets up a real holding, distributes a dividend through the corporate-actions engine,
 * then asserts the cockpit projections: positions (valued holding), distributions
 * (the dividend received), and the informational tax summary.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-portfolio-${Date.now()}.db`;

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
  (config as { EQUITIES_ENABLED: boolean }).EQUITIES_ENABLED = true; // enables corporate actions + equity assets
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
async function makeUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`pf-${seq++}-${Date.now()}@test.com`, "Holder");
  await getOrCreateUserAccount(u.id, "user_cash", "USD");
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}

/** Give `userId` `qty` whole units of `assetId` by moving them from the asset treasury. */
async function grantUnits(userId: string, assetId: string, qty: bigint) {
  const { postJournal, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, assetLedgerCode } =
    await import("../src/services/ledgerService");
  const code = assetLedgerCode(assetId);
  const treasury = await getOrCreateAssetTreasury(assetId);
  const holder = await getOrCreateUserAssetAccount(userId, assetId);
  await postJournal(
    [
      { ledgerAccountId: treasury, direction: "debit", amountMinor: qty, currency: code },
      { ledgerAccountId: holder, direction: "credit", amountMinor: qty, currency: code },
    ],
    "test: grant units",
    { idempotencyKey: `test:grant:${assetId}:${userId}` }
  );
}

describe("holder portfolio (P3)", () => {
  it("projects positions, distributions, and a tax summary from the ledger", async () => {
    const { createAsset } = await import("../src/services/tokenizationService");
    const { declareCorporateAction, distributeDividend } = await import("../src/services/corporateActionService");
    const { getPortfolio } = await import("../src/services/marketplaceService");
    const { getDistributions, getTaxSummary } = await import("../src/services/portfolioService");

    const holder = await makeUser();
    const asset = await createAsset({
      kind: "equity", tokenStandard: "erc3643", name: "Acme Equity", symbol: "ACME", initialSupply: 1000n,
    });
    await grantUnits(holder, asset.id, 10n);

    // Positions: the holding shows up (qty 10).
    const port = await getPortfolio(holder);
    const holding = port.holdings.find((h) => h.symbol === "ACME");
    expect(holding).toBeTruthy();
    expect(holding!.qtyBase).toBe("10");

    // Declare + distribute a $1.00 / unit dividend → holder receives $10.00.
    const ca = await declareCorporateAction({ assetId: asset.id, type: "dividend", amountPerUnitMinor: 100n, currency: "USD" });
    const dist = await distributeDividend(ca.id);
    expect(dist.holdersPaid).toBeGreaterThanOrEqual(1);

    const distributions = await getDistributions(holder);
    expect(distributions.length).toBe(1);
    expect(distributions[0]!.label).toBe("ACME");
    expect(distributions[0]!.amountMinor).toBe("1000"); // 10 units × $1.00
    expect(distributions[0]!.currency).toBe("USD");

    // Tax summary for the current year aggregates the distribution.
    const year = new Date().getUTCFullYear();
    const tax = await getTaxSummary(holder, year);
    expect(tax.count).toBe(1);
    expect(tax.totalsByCurrency.USD).toBe("1000");
    expect(tax.byAsset).toEqual([{ label: "ACME", currency: "USD", totalMinor: "1000" }]);

    // A different year has nothing.
    const empty = await getTaxSummary(holder, year - 1);
    expect(empty.count).toBe(0);
    expect(empty.totalsByCurrency).toEqual({});
  });

  it("returns empty projections for a holder with no assets", async () => {
    const { getDistributions, getTaxSummary } = await import("../src/services/portfolioService");
    const { getPortfolio } = await import("../src/services/marketplaceService");
    const holder = await makeUser();
    expect((await getPortfolio(holder)).holdings.length).toBe(0);
    expect((await getDistributions(holder)).length).toBe(0);
    expect((await getTaxSummary(holder, new Date().getUTCFullYear())).count).toBe(0);
  });
});
