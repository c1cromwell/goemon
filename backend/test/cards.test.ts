/**
 * Phase 19.4 — debit cards.
 *
 *   - issue a card (masked PAN only);
 *   - authorize places a hold (user_cash → card_holds), enforces balance + freeze gates,
 *     idempotent on replay;
 *   - capture settles the hold out (card_holds → external_clearing);
 *   - void releases an uncaptured hold back to the cardholder;
 *   - refund returns a captured amount;
 *   - CARDS_ENABLED gates everything; productionFatals refuses it in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-cards-${Date.now()}.db`;
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
  (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true;
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
  return createUser(`card-${seq++}-${Date.now()}@test.com`, "Card User"); // $10,000 opening
}
async function cash(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("issue + authorize", () => {
  it("issues a masked card and holds funds on authorize (idempotent)", async () => {
    const { issueCard, authorize } = await import("../src/services/cardService");
    const user = await newUser();
    const card = await issueCard(user.id);
    expect(card.masked_number).toMatch(/^••••\d{4}$/);

    const before = await cash(user.id);
    const key = `auth-${uuidv4()}`;
    const a1 = await authorize({ userId: user.id, cardId: card.id, amountMinor: 7_500n, merchant: "Acme", idempotencyKey: key });
    expect(a1.status).toBe("authorized");
    expect(await cash(user.id)).toBe(before - 7_500n); // held out of spendable cash

    const a2 = await authorize({ userId: user.id, cardId: card.id, amountMinor: 7_500n, merchant: "Acme", idempotencyKey: key });
    expect(a2.id).toBe(a1.id);
    expect(await cash(user.id)).toBe(before - 7_500n); // no double hold
  });

  it("rejects an over-balance authorization and a frozen account", async () => {
    const { issueCard, authorize } = await import("../src/services/cardService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const user = await newUser();
    const card = await issueCard(user.id);
    await expect(authorize({ userId: user.id, cardId: card.id, amountMinor: 99_999_999n, idempotencyKey: `a-${uuidv4()}` })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
    await placeHold({ userId: user.id, reason: "test", source: "admin" });
    await expect(authorize({ userId: user.id, cardId: card.id, amountMinor: 100n, idempotencyKey: `a-${uuidv4()}` })).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("capture / void / refund", () => {
  it("capture settles the hold; cash stays spent", async () => {
    const { issueCard, authorize, capture } = await import("../src/services/cardService");
    const user = await newUser();
    const card = await issueCard(user.id);
    const before = await cash(user.id);
    const a = await authorize({ userId: user.id, cardId: card.id, amountMinor: 5_000n, idempotencyKey: `a-${uuidv4()}` });
    const cap = await capture(a.id);
    expect(cap.captured).toBe(true);
    expect(await cash(user.id)).toBe(before - 5_000n); // money left the account
  });

  it("void releases an uncaptured hold back to the cardholder", async () => {
    const { issueCard, authorize, voidAuthorization } = await import("../src/services/cardService");
    const user = await newUser();
    const card = await issueCard(user.id);
    const before = await cash(user.id);
    const a = await authorize({ userId: user.id, cardId: card.id, amountMinor: 3_000n, idempotencyKey: `a-${uuidv4()}` });
    expect(await cash(user.id)).toBe(before - 3_000n);
    await voidAuthorization(a.id);
    expect(await cash(user.id)).toBe(before); // released
  });

  it("refund returns a captured amount", async () => {
    const { issueCard, authorize, capture, refund } = await import("../src/services/cardService");
    const user = await newUser();
    const card = await issueCard(user.id);
    const before = await cash(user.id);
    const a = await authorize({ userId: user.id, cardId: card.id, amountMinor: 2_000n, idempotencyKey: `a-${uuidv4()}` });
    await capture(a.id);
    expect(await cash(user.id)).toBe(before - 2_000n);
    await refund(a.id);
    expect(await cash(user.id)).toBe(before); // refunded
  });

  it("cannot capture a voided auth", async () => {
    const { issueCard, authorize, voidAuthorization, capture } = await import("../src/services/cardService");
    const user = await newUser();
    const card = await issueCard(user.id);
    const a = await authorize({ userId: user.id, cardId: card.id, amountMinor: 1_000n, idempotencyKey: `a-${uuidv4()}` });
    await voidAuthorization(a.id);
    await expect(capture(a.id)).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});

describe("kill-switch", () => {
  it("CARDS_ENABLED gates issuance", async () => {
    const { issueCard } = await import("../src/services/cardService");
    const { config } = await import("../src/config");
    const user = await newUser();
    (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = false;
    try {
      await expect(issueCard(user.id)).rejects.toMatchObject({ code: ErrorCode.CARDS_DISABLED });
    } finally {
      (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true;
    }
  });

  it("productionFatals refuses CARDS_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, CARDS_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("CARDS_ENABLED"))).toBe(false);
    const on = { ...base, CARDS_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("CARDS_ENABLED"))).toBe(true);
  });
});
