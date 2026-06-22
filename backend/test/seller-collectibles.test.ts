/**
 * Seller collectible submissions — cert gate + human review.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-seller-collectibles-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
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

describe("seller collectible submissions", () => {
  it("verifies simulated PSA cert and submits for human review", async () => {
    const { getDb } = await import("../src/db");
    const sellerId = uuidv4();
    await getDb().execute("INSERT INTO users (id, email) VALUES (?, ?)", [sellerId, `${sellerId}@test.com`]);

    const { previewCert, submitSellerListing } = await import("../src/services/sellerCollectibleService");
    const preview = await previewCert("psa", "12345678");
    expect(preview.cert.verified).toBe(true);
    expect(preview.cert.grade).toBe("10");

    const sub = await submitSellerListing({
      sellerUserId: sellerId,
      category: "pokemon",
      grader: "psa",
      certNumber: "12345678",
      askUsdcMicro: 99_000_000n,
      imageUrls: ["https://example.com/card.jpg"],
      runAiPreGrade: true,
    });
    expect(sub.status).toBe("pending_human");
    expect(sub.certVerified).toBe(true);
    expect(sub.comp).toBeTruthy();
    expect(sub.aiGrade).toBeTruthy();
  });

  it("admin approve publishes listing to marketplace", async () => {
    const { getDb } = await import("../src/db");
    const {
      submitSellerListing,
      listPendingSubmissions,
      approveSubmission,
    } = await import("../src/services/sellerCollectibleService");
    const { getCurrentListing } = await import("../src/services/listingService");

    const sellerId = uuidv4();
    await getDb().execute("INSERT INTO users (id, email) VALUES (?, ?)", [sellerId, `${sellerId}@test.com`]);

    const sub = await submitSellerListing({
      sellerUserId: sellerId,
      category: "sports",
      grader: "psa",
      certNumber: "87654321",
      askUsdcMicro: 250_000_000n,
    });

    const pending = await listPendingSubmissions();
    expect(pending.some((p) => p.id === sub.id)).toBe(true);

    const { assetId } = await approveSubmission(sub.id, "admin-reviewer");
    const listing = await getCurrentListing(assetId);
    expect(listing?.status).toBe("public");
  });

  it("rejects invalid cert number format", async () => {
    const { verifySlabCert } = await import("../src/services/certVerificationService");
    await expect(verifySlabCert("psa", "abc")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
