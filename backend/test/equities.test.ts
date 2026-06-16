/**
 * Phase 18.6 — tokenized 1:1-backed equities (prototype seam).
 *
 *   - dividend distribution pays every holder pro-rata (qtyBase * per-share) and is
 *     idempotent on replay (no double-pay);
 *   - redemption burns the holding and delivers proceeds atomically, idempotent on the
 *     Idempotency-Key;
 *   - an ineligible holder is compliance-blocked on buy (equity is treated as a security);
 *   - the simulated issuer surfaces a 1:1 backing attestation;
 *   - EQUITIES_ENABLED gates the endpoints; productionFatals refuses it in prod.
 *
 * Equity tokens are whole-share (decimals 0): per-share == per-base-unit, matching the
 * marketplace's `gross = qtyBase * priceMinor`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-equities-${Date.now()}.db`;
const PRICE = 10_000n; // $100.00 / share
let seq = 0;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { EQUITIES_ENABLED: boolean }).EQUITIES_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function newUser() {
  const { createUser } = await import("../src/services/authService");
  return createUser(`eq-${seq++}-${Date.now()}@test.com`, "Equity User"); // $10,000 opening
}

async function newEquity(minTier = 0, supply = 1000n, symbol = "AAPLx") {
  const { createAsset } = await import("../src/services/tokenizationService");
  const { createListing, transitionListing } = await import("../src/services/listingService");
  const asset = await createAsset({
    kind: "equity", tokenStandard: "erc3643", name: `${symbol} share`, symbol, decimals: 0, minTier, initialSupply: supply,
  });
  await createListing({ assetId: asset.id, surface: "invest", priceMinor: PRICE, priceSource: "spot", reviewer: "test-admin" });
  await transitionListing(asset.id, "soft", "test-admin");
  return asset;
}

async function cash(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("dividend distribution", () => {
  it("pays every holder pro-rata and is idempotent on replay", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const { declareCorporateAction, distributeDividend } = await import("../src/services/corporateActionService");

    const asset = await newEquity(0);
    const alice = await newUser();
    const bob = await newUser();
    await placeOrder(alice.id, asset.id, "buy", 3n, uuidv4());
    await placeOrder(bob.id, asset.id, "buy", 2n, uuidv4());

    const aBefore = await cash(alice.id);
    const bBefore = await cash(bob.id);

    const ca = await declareCorporateAction({ assetId: asset.id, type: "dividend", amountPerUnitMinor: 50n }); // $0.50/share
    const r1 = await distributeDividend(ca.id);
    expect(r1.holdersPaid).toBe(2);
    expect(r1.totalMinor).toBe(3n * 50n + 2n * 50n);
    expect(await cash(alice.id)).toBe(aBefore + 150n);
    expect(await cash(bob.id)).toBe(bBefore + 100n);

    // Idempotent: a re-run pays nothing more.
    const r2 = await distributeDividend(ca.id);
    expect(r2.holdersPaid).toBe(0);
    expect(await cash(alice.id)).toBe(aBefore + 150n);
  });
});

describe("redemption", () => {
  it("burns the holding, delivers proceeds, and is idempotent", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const { redeem } = await import("../src/services/redemptionService");
    const { getAssetBalance } = await import("../src/services/ledgerService");

    const asset = await newEquity(0);
    const user = await newUser();
    await placeOrder(user.id, asset.id, "buy", 5n, uuidv4());
    expect(await getAssetBalance(user.id, asset.id)).toBe(5n);

    const cashBefore = await cash(user.id);
    const key = `redeem-${uuidv4()}`;
    const r1 = await redeem({ userId: user.id, assetId: asset.id, qtyBase: 2n, idempotencyKey: key });
    expect(r1.proceedsMinor).toBe(2n * PRICE);
    expect(await getAssetBalance(user.id, asset.id)).toBe(3n); // burned 2
    expect(await cash(user.id)).toBe(cashBefore + 2n * PRICE);

    // Replay with the same key → same redemption, no further burn/payout.
    const r2 = await redeem({ userId: user.id, assetId: asset.id, qtyBase: 2n, idempotencyKey: key });
    expect(r2.redemptionId).toBe(r1.redemptionId);
    expect(await getAssetBalance(user.id, asset.id)).toBe(3n);
    expect(await cash(user.id)).toBe(cashBefore + 2n * PRICE);
  });
});

describe("compliance + backing + kill-switch", () => {
  it("blocks an ineligible holder on buy (equity is a security)", async () => {
    const { placeOrder } = await import("../src/services/marketplaceService");
    const asset = await newEquity(2); // requires Tier 2
    const tier0 = await newUser(); // default Tier 0
    await expect(placeOrder(tier0.id, asset.id, "buy", 1n, uuidv4())).rejects.toMatchObject({
      code: ErrorCode.COMPLIANCE_BLOCKED,
    });
  });

  it("surfaces a 1:1 backing attestation", async () => {
    const { backingAttestation } = await import("../src/services/redemptionService");
    const asset = await newEquity(0, 500n, "MSFTx");
    const a = await backingAttestation(asset.id);
    expect(a.backedOneToOne).toBe(true);
    expect(a.symbol).toBe("MSFTx");
    expect(a.tokenSupply).toBe(500n);
    expect(a.sharesCustodied).toBe(500n);
  });

  it("EQUITIES_ENABLED gates the endpoints", async () => {
    const { config } = await import("../src/config");
    const { backingAttestation } = await import("../src/services/redemptionService");
    const asset = await newEquity(0);
    (config as { EQUITIES_ENABLED: boolean }).EQUITIES_ENABLED = false;
    try {
      await expect(backingAttestation(asset.id)).rejects.toMatchObject({ code: ErrorCode.EQUITIES_DISABLED });
    } finally {
      (config as { EQUITIES_ENABLED: boolean }).EQUITIES_ENABLED = true;
    }
  });

  it("productionFatals refuses EQUITIES_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, EQUITIES_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("EQUITIES_ENABLED"))).toBe(false);
    const on = { ...base, EQUITIES_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("EQUITIES_ENABLED"))).toBe(true);
  });
});
