/**
 * Seller P2P collectible escrow purchases — buy → ship → confirm without a vault partner.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-collectible-escrow-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.COLLECTIBLES_ESCROW_ENABLED = "true";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function creditUser(userId: string, amountMinor: bigint, currency = "USDC") {
  const { getOrCreateUserAccount, getSystemAccount, postJournal } = await import("../src/services/ledgerService");
  const userCash = await getOrCreateUserAccount(userId, "user_cash", currency);
  const clearing = await getSystemAccount("external_clearing", currency);
  await postJournal(
    [
      { ledgerAccountId: clearing, direction: "debit", amountMinor, currency },
      { ledgerAccountId: userCash, direction: "credit", amountMinor, currency },
    ],
    `Test credit ${userId}`,
    { idempotencyKey: `test:credit:${userId}:${amountMinor}` }
  );
}

async function approveDemoListing(sellerId: string, certNumber: string) {
  const { submitSellerListing, approveSubmission } = await import("../src/services/sellerCollectibleService");
  const sub = await submitSellerListing({
    sellerUserId: sellerId,
    category: "pokemon",
    grader: "psa",
    certNumber,
    askUsdcMicro: 50_000_000n,
  });
  const { assetId } = await approveSubmission(sub.id, "admin");
  return assetId;
}

describe("collectible escrow purchases", () => {
  it("kill-switch off ⇒ COLLECTIBLES_ESCROW_DISABLED", async () => {
    const { config } = await import("../src/config");
    (config as { COLLECTIBLES_ESCROW_ENABLED: boolean }).COLLECTIBLES_ESCROW_ENABLED = false;
    const { purchaseListing } = await import("../src/services/collectiblePurchaseService");
    await expect(
      purchaseListing({ buyerUserId: uuidv4(), assetId: uuidv4(), idempotencyKey: "ks-1" })
    ).rejects.toMatchObject({ code: "COLLECTIBLES_ESCROW_DISABLED" });
    (config as { COLLECTIBLES_ESCROW_ENABLED: boolean }).COLLECTIBLES_ESCROW_ENABLED = true;
  });

  it("buy → ship → confirm delivers asset and pays seller", async () => {
    const { getDb } = await import("../src/db");
    const sellerId = uuidv4();
    const buyerId = uuidv4();
    await getDb().execute(
      "INSERT INTO users (id, email) VALUES (?, ?), (?, ?)",
      [sellerId, `${sellerId}@test.com`, buyerId, `${buyerId}@test.com`]
    );
    await creditUser(buyerId, 100_000_000n);

    const assetId = await approveDemoListing(sellerId, "12345678");

    const {
      purchaseListing,
      markShipped,
      confirmReceipt,
      getPurchase,
    } = await import("../src/services/collectiblePurchaseService");
    const { getAssetBalance } = await import("../src/services/ledgerService");
    const { getBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");

    const purchase = await purchaseListing({
      buyerUserId: buyerId,
      assetId,
      idempotencyKey: "buy-1",
    });
    expect(purchase.status).toBe("escrow_held");

    const sellerCash = await getOrCreateUserAccount(sellerId, "user_cash", "USDC");
    expect(await getBalance(sellerCash)).toBe(0n);

    await markShipped(purchase.id, sellerId);
    await confirmReceipt(purchase.id, buyerId);

    const done = await getPurchase(purchase.id);
    expect(done.status).toBe("completed");
    expect(await getAssetBalance(buyerId, assetId)).toBe(1n);
    expect(await getBalance(sellerCash)).toBe(50_000_000n);
  });

  it("idempotent replay on purchase idempotency key", async () => {
    const { getDb } = await import("../src/db");
    const sellerId = uuidv4();
    const buyerId = uuidv4();
    await getDb().execute(
      "INSERT INTO users (id, email) VALUES (?, ?), (?, ?)",
      [sellerId, `${sellerId}@test.com`, buyerId, `${buyerId}@test.com`]
    );
    await creditUser(buyerId, 100_000_000n);
    const assetId = await approveDemoListing(sellerId, "87654321");

    const { purchaseListing } = await import("../src/services/collectiblePurchaseService");
    const first = await purchaseListing({ buyerUserId: buyerId, assetId, idempotencyKey: "dup-key" });
    const second = await purchaseListing({ buyerUserId: buyerId, assetId, idempotencyKey: "dup-key" });
    expect(second.id).toBe(first.id);
  });

  it("blocks instant placeOrder for seller_p2p assets", async () => {
    const { getDb } = await import("../src/db");
    const sellerId = uuidv4();
    const buyerId = uuidv4();
    await getDb().execute(
      "INSERT INTO users (id, email) VALUES (?, ?), (?, ?)",
      [sellerId, `${sellerId}@test.com`, buyerId, `${buyerId}@test.com`]
    );
    const assetId = await approveDemoListing(sellerId, "12345678");
    const { placeOrder } = await import("../src/services/marketplaceService");
    await expect(placeOrder(buyerId, assetId, "buy", 1n, uuidv4())).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("seller cancel before ship refunds buyer and relists", async () => {
    const { getDb } = await import("../src/db");
    const sellerId = uuidv4();
    const buyerId = uuidv4();
    await getDb().execute(
      "INSERT INTO users (id, email) VALUES (?, ?), (?, ?)",
      [sellerId, `${sellerId}@test.com`, buyerId, `${buyerId}@test.com`]
    );
    await creditUser(buyerId, 100_000_000n);
    const assetId = await approveDemoListing(sellerId, "12345678");

    const { purchaseListing, cancelBeforeShip } = await import("../src/services/collectiblePurchaseService");
    const { getBalance, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const { getCurrentListing } = await import("../src/services/listingService");

    const purchase = await purchaseListing({ buyerUserId: buyerId, assetId, idempotencyKey: "cancel-1" });
    await cancelBeforeShip(purchase.id, sellerId);

    const buyerCash = await getOrCreateUserAccount(buyerId, "user_cash", "USDC");
    expect(await getBalance(buyerCash)).toBe(100_000_000n);
    const listing = await getCurrentListing(assetId);
    expect(listing?.status).toBe("public");
  });
});
