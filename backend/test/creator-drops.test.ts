/**
 * X-Money response F5 — collector/creator drops.
 *
 *   1. createDrop issues a limited tokenized edition (asset + supply = edition size).
 *   2. claim: buyer pays the creator DIRECTLY and receives one owned edition token.
 *   3. scarcity: claiming the whole edition sells it out; further claims are rejected.
 *   4. claim is idempotent; you can't claim your own drop; insufficient funds rejected.
 *   5. CREATOR_DROPS_ENABLED off ⇒ disabled; productionFatals refuses it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";

const TMP_DB = `./data/test-drops-${Date.now()}.db`;

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
  (config as { CREATOR_DROPS_ENABLED: boolean }).CREATOR_DROPS_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function cashOf(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}
async function newUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`drop-${Date.now()}-${Math.random()}@test.com`, "D");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  return u.id;
}

describe("Collector/creator drops (F5)", () => {
  it("create + claim: buyer pays the creator directly and owns the edition token", async () => {
    const { createDrop, claimDrop } = await import("../src/services/creatorDropService");
    const { getOrCreateUserAssetAccount, getBalance } = await import("../src/services/ledgerService");
    const creator = await newUser();
    const fan = await newUser();
    const drop = await createDrop({ creatorUserId: creator, name: "Genesis Card", symbol: "GEN", editionSize: 3, priceMinor: 2_500n });
    expect(drop.status).toBe("active");
    expect(drop.editionSize).toBe(3);

    const cBefore = await cashOf(creator);
    const fBefore = await cashOf(fan);
    const claim = await claimDrop({ dropId: drop.id, buyerUserId: fan, idempotencyKey: uuidv4() });
    expect(claim.editionNumber).toBe(1);

    expect(await cashOf(fan)).toBe(fBefore - 2_500n);     // fan paid
    expect(await cashOf(creator)).toBe(cBefore + 2_500n); // creator paid DIRECTLY
    const holding = await getOrCreateUserAssetAccount(fan, drop.assetId);
    expect(await getBalance(holding)).toBe(1n);            // fan owns 1 edition token
  });

  it("scarcity: a limited edition sells out at the ledger", async () => {
    const { createDrop, claimDrop, getDrop } = await import("../src/services/creatorDropService");
    const { ErrorCode } = await import("../src/errors");
    const creator = await newUser();
    const drop = await createDrop({ creatorUserId: creator, name: "1/1", editionSize: 2, priceMinor: 1_000n });
    await claimDrop({ dropId: drop.id, buyerUserId: await newUser(), idempotencyKey: uuidv4() });
    const last = await claimDrop({ dropId: drop.id, buyerUserId: await newUser(), idempotencyKey: uuidv4() });
    expect(last.editionNumber).toBe(2);
    expect(last.status).toBe("sold_out");
    expect((await getDrop(drop.id))!.status).toBe("sold_out");
    await expect(claimDrop({ dropId: drop.id, buyerUserId: await newUser(), idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("idempotent claim; can't claim own drop; insufficient funds rejected", async () => {
    const { createDrop, claimDrop } = await import("../src/services/creatorDropService");
    const { ErrorCode } = await import("../src/errors");
    const creator = await newUser();
    const fan = await newUser();
    const drop = await createDrop({ creatorUserId: creator, name: "Idem", editionSize: 5, priceMinor: 1_000n });

    const key = uuidv4();
    const before = await cashOf(fan);
    const a = await claimDrop({ dropId: drop.id, buyerUserId: fan, idempotencyKey: key });
    const b = await claimDrop({ dropId: drop.id, buyerUserId: fan, idempotencyKey: key }); // replay
    expect(b.journalId).toBe(a.journalId);
    expect(await cashOf(fan)).toBe(before - 1_000n); // charged once

    await expect(claimDrop({ dropId: drop.id, buyerUserId: creator, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.VALIDATION }); // own drop

    const broke = await newUser();
    const pricey = await createDrop({ creatorUserId: creator, name: "Pricey", editionSize: 1, priceMinor: 9_999_999n });
    await expect(claimDrop({ dropId: pricey.id, buyerUserId: broke, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("CREATOR_DROPS_ENABLED off ⇒ disabled; productionFatals refuses it", async () => {
    const { config } = await import("../src/config");
    const { createDrop } = await import("../src/services/creatorDropService");
    (config as { CREATOR_DROPS_ENABLED: boolean }).CREATOR_DROPS_ENABLED = false;
    try {
      await expect(createDrop({ creatorUserId: "x", name: "x", editionSize: 1, priceMinor: 1n }))
        .rejects.toMatchObject({ code: "CREATOR_DROPS_DISABLED" });
    } finally {
      (config as { CREATOR_DROPS_ENABLED: boolean }).CREATOR_DROPS_ENABLED = true;
    }
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, CREATOR_DROPS_ENABLED: true,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("CREATOR_DROPS_ENABLED"))).toBe(true);
  });
});
