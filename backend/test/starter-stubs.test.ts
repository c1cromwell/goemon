/**
 * Phase 22.4–22.5 — credit-builder + custodial investing stub seams.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-starter-stubs-${Date.now()}.db`;
let seq = 0;
function uniqEmail(p: string) {
  return `${p}-${seq++}-${uuidv4()}@test.com`;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { TEEN_ENABLED: boolean }).TEEN_ENABLED = true;
  (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true;
  (config as { TEEN_CREDIT_BUILDER_ENABLED: boolean }).TEEN_CREDIT_BUILDER_ENABLED = true;
  (config as { TEEN_CUSTODIAL_ENABLED: boolean }).TEEN_CUSTODIAL_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function household() {
  const { createUser } = await import("../src/services/authService");
  const { createHousehold, addTeen } = await import("../src/services/householdService");
  const { getDb } = await import("../src/db");
  const guardian = await createUser(uniqEmail("g"), "Guardian");
  await getDb().execute("UPDATE identity_profiles SET tier = 2 WHERE user_id = ?", [guardian.id]);
  await createHousehold(guardian.id);
  const teen = await addTeen({
    guardianUserId: guardian.id,
    email: uniqEmail("teen"),
    fullName: "Teen",
    dob: "2011-01-01",
  });
  return { guardian, teen };
}

describe("22.4 credit-builder", () => {
  it("opens account, charges, closes statement, autopays, and reports to bureau", async () => {
    const { openCreditBuilderAccount, closeStatement, autopayStatement, reportStatementToBureau } = await import(
      "../src/services/creditBuilderService"
    );
    const { authorize } = await import("../src/services/cardService");
    const { getOrCreateUserAccount, postJournal } = await import("../src/services/ledgerService");
    const { guardian, teen } = await household();

    const account = await openCreditBuilderAccount({
      guardianUserId: guardian.id,
      teenUserId: teen.userId,
      securedLimitMinor: 20_000n,
    });
    expect(account.card_id).toBeTruthy();

    const teenCash = await getOrCreateUserAccount(teen.userId, "user_cash", "USD");
    await postJournal(
      [
        { ledgerAccountId: await getOrCreateUserAccount(guardian.id, "user_cash", "USD"), direction: "debit", amountMinor: 5_000n, currency: "USD" },
        { ledgerAccountId: teenCash, direction: "credit", amountMinor: 5_000n, currency: "USD" },
      ],
      "allowance",
      { idempotencyKey: `a-${uuidv4()}` }
    );

    await authorize({
      userId: teen.userId,
      cardId: account.card_id!,
      amountMinor: 3_000n,
      merchant: "Bookstore",
      idempotencyKey: `cb-${uuidv4()}`,
    });

    const stmt = await closeStatement(account.id, "2026-06");
    expect(stmt.closing_minor).toBe("3000");

    const paid = await autopayStatement(guardian.id, stmt.id, `pay-${uuidv4()}`);
    expect(paid.status).toBe("paid");

    const report = await reportStatementToBureau(guardian.id, stmt.id);
    expect(report.externalRef).toMatch(/^sim-bureau-/);
  });

  it("productionFatals refuses TEEN_CREDIT_BUILDER_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(48),
      ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false,
      KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated",
      SMARTCHAT_ORCHESTRATOR: "simulated",
      OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "",
      HEDERA_ENABLED: false,
      TEEN_CREDIT_BUILDER_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    const on = { ...base, TEEN_CREDIT_BUILDER_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("TEEN_CREDIT_BUILDER_ENABLED"))).toBe(true);
  });
});

describe("22.5 custodial investing", () => {
  it("opens custodial account and settles order after guardian approval", async () => {
    const { openCustodialAccount, proposeCustodialOrder, resolveCustodialOrder } = await import(
      "../src/services/custodialInvestingService"
    );
    const { createAsset } = await import("../src/services/tokenizationService");
    const { createListing, transitionListing } = await import("../src/services/listingService");
    const { getOrCreateUserAccount, postJournal } = await import("../src/services/ledgerService");
    const { guardian, teen } = await household();

    const account = await openCustodialAccount({ guardianUserId: guardian.id, teenUserId: teen.userId, accountType: "ugma" });
    expect(account.account_type).toBe("ugma");

    const asset = await createAsset({ kind: "collectible", tokenStandard: "hts", name: "Custodial Test", minTier: 0, initialSupply: 10n });
    await createListing({ assetId: asset.id, surface: "collect", priceMinor: 1_000n, priceSource: "test", reviewer: "test-admin" });
    await transitionListing(asset.id, "soft", "test-admin");

    const teenCash = await getOrCreateUserAccount(teen.userId, "user_cash", "USD");
    await postJournal(
      [
        { ledgerAccountId: await getOrCreateUserAccount(guardian.id, "user_cash", "USD"), direction: "debit", amountMinor: 50_000n, currency: "USD" },
        { ledgerAccountId: teenCash, direction: "credit", amountMinor: 50_000n, currency: "USD" },
      ],
      "fund teen",
      { idempotencyKey: `f-${uuidv4()}` }
    );

    const order = await proposeCustodialOrder({
      teenUserId: teen.userId,
      assetId: asset.id,
      side: "buy",
      qtyBase: 1n,
      idempotencyKey: `co-${uuidv4()}`,
    });
    expect(order.status).toBe("pending");

    const result = await resolveCustodialOrder(guardian.id, order.review_id!, "approve");
    expect(result.status).toBe("settled");
    expect(result.order?.marketplace_order_id).toBeTruthy();
  });

  it("productionFatals refuses TEEN_CUSTODIAL_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(48),
      ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false,
      KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated",
      SMARTCHAT_ORCHESTRATOR: "simulated",
      OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "",
      HEDERA_ENABLED: false,
      TEEN_CUSTODIAL_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    const on = { ...base, TEEN_CUSTODIAL_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("TEEN_CUSTODIAL_ENABLED"))).toBe(true);
  });
});

describe("kill switches", () => {
  it("TEEN_CREDIT_BUILDER_DISABLED when off", async () => {
    const { config } = await import("../src/config");
    const { openCreditBuilderAccount } = await import("../src/services/creditBuilderService");
    (config as { TEEN_CREDIT_BUILDER_ENABLED: boolean }).TEEN_CREDIT_BUILDER_ENABLED = false;
    const { guardian, teen } = await household();
    await expect(
      openCreditBuilderAccount({ guardianUserId: guardian.id, teenUserId: teen.userId, securedLimitMinor: 1000n })
    ).rejects.toMatchObject({ code: ErrorCode.TEEN_CREDIT_BUILDER_DISABLED });
    (config as { TEEN_CREDIT_BUILDER_ENABLED: boolean }).TEEN_CREDIT_BUILDER_ENABLED = true;
  });
});
