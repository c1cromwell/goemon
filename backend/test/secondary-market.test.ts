/**
 * Phase 29 P6 — secondary market (limit order book + matching engine).
 *
 * Covers escrow, crossing at the maker price with buyer price-improvement refund, partial
 * fills, cancel refunds, the order book aggregation, compliance on buy, and the kill-switch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-secondary-${Date.now()}.db`;

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
  (config as { SECONDARY_MARKET_ENABLED: boolean }).SECONDARY_MARKET_ENABLED = true;
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
  const u = await createUser(`mkt-${seq++}-${Date.now()}@test.com`, "Trader");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}
async function makeAssetHeldBy(holder: string, units: bigint) {
  const { createAsset } = await import("../src/services/tokenizationService");
  const { postJournal, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, assetLedgerCode } = await import("../src/services/ledgerService");
  const asset = await createAsset({ kind: "collectible", tokenStandard: "hts", name: "Tradeable", symbol: "TRD", minTier: 0, initialSupply: units * 2n });
  const code = assetLedgerCode(asset.id);
  const t = await getOrCreateAssetTreasury(asset.id);
  const h = await getOrCreateUserAssetAccount(holder, asset.id);
  await postJournal([{ ledgerAccountId: t, direction: "debit", amountMinor: units, currency: code }, { ledgerAccountId: h, direction: "credit", amountMinor: units, currency: code }], "seed holding", { idempotencyKey: `seed:${asset.id}:${holder}` });
  return asset.id;
}
const key = () => `k-${seq++}-${Math.random().toString(36).slice(2)}`;
async function cash(userId: string) {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("secondary market — matching", () => {
  it("crosses a resting sell with a taker buy at the maker price (buyer gets price improvement)", async () => {
    const svc = await import("../src/services/secondaryMarketService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const seller = await makeUser(); const buyer = await makeUser();
    const asset = await makeAssetHeldBy(seller, 100n);

    // Seller rests: sell 10 @ $5.
    const s = await svc.placeOrder({ assetId: asset, userId: seller, side: "sell", qty: 10n, limitPriceMinor: 500n, idempotencyKey: key() });
    expect(s.fills.length).toBe(0);
    // Buyer takes: buy 10 @ $6 → fills at the maker's $5, buyer refunded the $1/unit difference.
    const b = await svc.placeOrder({ assetId: asset, userId: buyer, side: "buy", qty: 10n, limitPriceMinor: 600n, idempotencyKey: key() });
    expect(b.fills.length).toBe(1);
    expect(b.fills[0]!.priceMinor).toBe("500");
    expect(b.order.status).toBe("filled");

    expect(await getAssetBalance(buyer, asset)).toBe(10n);
    expect(await cash(seller)).toBe(1005000n); // $10,000 + $50 (10 × $5)
    expect(await cash(buyer)).toBe(995000n);   // $10,000 - $50 (escrowed $60, paid $50, refunded $10)
  });

  it("partially fills and rests the remainder; cancel refunds it", async () => {
    const svc = await import("../src/services/secondaryMarketService");
    const seller = await makeUser(); const buyer = await makeUser();
    const asset = await makeAssetHeldBy(seller, 100n);

    await svc.placeOrder({ assetId: asset, userId: seller, side: "sell", qty: 5n, limitPriceMinor: 1000n, idempotencyKey: key() }); // sell 5 @ $10
    const b = await svc.placeOrder({ assetId: asset, userId: buyer, side: "buy", qty: 12n, limitPriceMinor: 1000n, idempotencyKey: key() }); // buy 12 @ $10
    expect(b.fills.length).toBe(1);
    expect(b.fills[0]!.qty).toBe("5");
    expect(b.order.status).toBe("open");
    expect(b.order.qtyRemaining).toBe(7n);

    const book = await svc.getBook(asset);
    expect(book.bids).toEqual([{ priceMinor: "1000", qty: "7" }]); // 7 remaining rest as a bid

    // Cancel the rest → the 7×$10 = $70 escrow is refunded.
    const before = await cash(buyer);
    await svc.cancelOrder(b.order.id, buyer);
    expect(await cash(buyer)).toBe(before + 7000n);
    expect((await svc.getBook(asset)).bids).toEqual([]);
  });

  it("blocks self-trading and enforces compliance on the buyer", async () => {
    const svc = await import("../src/services/secondaryMarketService");
    const { createAsset } = await import("../src/services/tokenizationService");
    const { postJournal, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, assetLedgerCode } = await import("../src/services/ledgerService");
    const seller = await makeUser();
    // A Tier-2-gated security.
    const asset = await createAsset({ kind: "security", tokenStandard: "erc3643", name: "Gated", symbol: "GATE", minTier: 2, jurisdictionAllow: ["US"], initialSupply: 100n });
    const code = assetLedgerCode(asset.id);
    const t = await getOrCreateAssetTreasury(asset.id);
    const h = await getOrCreateUserAssetAccount(seller, asset.id);
    await postJournal([{ ledgerAccountId: t, direction: "debit", amountMinor: 50n, currency: code }, { ledgerAccountId: h, direction: "credit", amountMinor: 50n, currency: code }], "seed", { idempotencyKey: `seed2:${asset.id}` });

    await svc.placeOrder({ assetId: asset.id, userId: seller, side: "sell", qty: 10n, limitPriceMinor: 100n, idempotencyKey: key() });
    // Self-trade: the seller's own buy must NOT match their sell.
    const self = await svc.placeOrder({ assetId: asset.id, userId: seller, side: "buy", qty: 5n, limitPriceMinor: 100n, idempotencyKey: key() });
    expect(self.fills.length).toBe(0);

    // A Tier-1 buyer is compliance-blocked from placing a buy at all.
    const { createUser } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const lowTier = await createUser(`low-${seq++}@test.com`, "Low");
    await getOrCreateUserAccount(lowTier.id, "user_cash", "USD");
    await getDb().execute("UPDATE identity_profiles SET tier = 1, jurisdiction = 'US' WHERE user_id = ?", [lowTier.id]);
    await expect(svc.placeOrder({ assetId: asset.id, userId: lowTier.id, side: "buy", qty: 1n, limitPriceMinor: 100n, idempotencyKey: key() })).rejects.toThrow();
  });

  it("refuses when the kill-switch is off", async () => {
    const { config } = await import("../src/config");
    const svc = await import("../src/services/secondaryMarketService");
    const seller = await makeUser();
    const asset = await makeAssetHeldBy(seller, 10n);
    (config as { SECONDARY_MARKET_ENABLED: boolean }).SECONDARY_MARKET_ENABLED = false;
    await expect(svc.placeOrder({ assetId: asset, userId: seller, side: "sell", qty: 1n, limitPriceMinor: 100n, idempotencyKey: key() })).rejects.toThrow();
    (config as { SECONDARY_MARKET_ENABLED: boolean }).SECONDARY_MARKET_ENABLED = true;
  });
});
