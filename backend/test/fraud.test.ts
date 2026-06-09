/**
 * Stage 1 fraud seam tests (docs/business/FraudEngine-GapAnalysis.md §5).
 *
 * Verifies the money-path screening contract:
 *   1. A benign transfer is scored, allowed, and recorded as action=allow.
 *   2. A fundable but anomalous transfer is blocked (FRAUD_BLOCKED) and recorded enforced.
 *   3. fraud_decisions is append-only (UPDATE blocked).
 *   4. Shadow mode (FRAUD_ENGINE_ENFORCE=false) records a block but lets it settle.
 *   5. An unfunded transfer surfaces INSUFFICIENT_FUNDS, not fraud (screen skipped).
 *   6. The pure scorer maps features → action deterministically.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-fraud-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
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

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
}

// ---------------------------------------------------------------------------
// Pure scorer (no DB)
// ---------------------------------------------------------------------------

describe("Stage 1 fraud: pure scorer", () => {
  it("allows a benign first transfer", async () => {
    const { scoreTransferFeatures } = await import("../src/services/fraudService");
    const d = scoreTransferFeatures(10_000n, { velocity: 1, newPayee: true, trailingMaxMinor: 0n });
    expect(d.action).toBe("allow");
    expect(d.score).toBeCloseTo(0.15, 5);
  });

  it("blocks a 10x amount spike to a new payee at a large absolute amount", async () => {
    const { scoreTransferFeatures } = await import("../src/services/fraudService");
    // 0.6 (spike_10x) + 0.3 (large_absolute) + 0.15 (new_payee) -> clamp 1.0
    const d = scoreTransferFeatures(900_000n, { velocity: 1, newPayee: true, trailingMaxMinor: 10_000n });
    expect(d.action).toBe("block");
    expect(d.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["amount_spike_10x", "large_absolute", "new_payee"])
    );
  });

  it("flags a large absolute transfer that is not a spike", async () => {
    const { scoreTransferFeatures } = await import("../src/services/fraudService");
    const d = scoreTransferFeatures(900_000n, { velocity: 1, newPayee: false, trailingMaxMinor: 0n });
    expect(d.action).toBe("flag"); // 0.3 large_absolute only
  });

  it("records the rules-v0 model version", async () => {
    const { scoreTransferFeatures, FRAUD_MODEL_VERSION } = await import("../src/services/fraudService");
    expect(scoreTransferFeatures(1n, { velocity: 0, newPayee: false, trailingMaxMinor: 0n }).modelVersion).toBe(
      FRAUD_MODEL_VERSION
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end screening on the money path
// ---------------------------------------------------------------------------

describe("Stage 1 fraud: money-path screening", () => {
  let carol: string;
  let dave: string;
  let erin: string;
  let frank: string;

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    for (const [email, name] of [
      ["carol@fraud.test", "Carol"],
      ["dave@fraud.test", "Dave"],
      ["erin@fraud.test", "Erin"],
      ["frank@fraud.test", "Frank"],
    ] as const) {
      const u = await createUser(email, name);
      await getOrCreateUserAccount(u.id, "user_cash", "USD");
      if (email.startsWith("carol")) carol = u.id;
      if (email.startsWith("dave")) dave = u.id;
      if (email.startsWith("erin")) erin = u.id;
      if (email.startsWith("frank")) frank = u.id;
    }
  });

  it("allows + records a benign first transfer", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { getDb } = await import("../src/db");

    await transfer({
      fromUserId: carol,
      toUserId: dave,
      amountMinor: 10_000n, // $100, first ever -> establishes trailing max
      currency: "USD",
      idempotencyKey: "fraud-benign-1",
    });

    const row = await getDb().queryOne<{ action: string; model_version: string }>(
      "SELECT action, model_version FROM fraud_decisions WHERE idempotency_key = ?",
      ["fraud-benign-1"]
    );
    expect(row?.action).toBe("allow");
    expect(row?.model_version).toBe("rules-v0");
  });

  it("blocks a fundable anomalous transfer with FRAUD_BLOCKED", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");

    // Carol has ~$9,900 left; $9,000 to a brand-new payee is a 10x spike vs her
    // $100 history + large absolute -> score clamps to block, and it IS funded.
    await expect(
      transfer({
        fromUserId: carol,
        toUserId: erin,
        amountMinor: 900_000n, // $9,000
        currency: "USD",
        idempotencyKey: "fraud-block-1",
      })
    ).rejects.toMatchObject({ code: ErrorCode.FRAUD_BLOCKED });

    const { getDb } = await import("../src/db");
    const row = await getDb().queryOne<{ action: string; enforced: number }>(
      "SELECT action, enforced FROM fraud_decisions WHERE idempotency_key = ?",
      ["fraud-block-1"]
    );
    expect(row?.action).toBe("block");
    expect(row?.enforced).toBe(1);
  });

  it("did not settle the blocked transfer (balance unchanged)", async () => {
    const { getUserBalances } = await import("../src/services/ledgerService");
    const bal = await getUserBalances(carol);
    expect(bal.cash).toBe(990_000n); // $10,000 - $100 benign, block never posted
  });

  it("fraud_decisions is append-only (UPDATE blocked)", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE fraud_decisions SET action = 'allow' WHERE idempotency_key = ?", ["fraud-block-1"])
    ).rejects.toThrow(/append-only/i);
  });

  it("shadow mode records a block but lets the transfer settle", async () => {
    const { config } = await import("../src/config");
    const { transfer } = await import("../src/services/transferService");
    const { getUserBalances } = await import("../src/services/ledgerService");
    const { getDb } = await import("../src/db");

    const prev = config.FRAUD_ENGINE_ENFORCE;
    (config as { FRAUD_ENGINE_ENFORCE: boolean }).FRAUD_ENGINE_ENFORCE = false;
    try {
      await transfer({
        fromUserId: carol,
        toUserId: frank,
        amountMinor: 900_000n, // same anomalous shape, different payee
        currency: "USD",
        idempotencyKey: "fraud-shadow-1",
      });
    } finally {
      (config as { FRAUD_ENGINE_ENFORCE: boolean }).FRAUD_ENGINE_ENFORCE = prev;
    }

    const bal = await getUserBalances(carol);
    expect(bal.cash).toBe(90_000n); // settled: 990,000 - 900,000

    const row = await getDb().queryOne<{ action: string; enforced: number }>(
      "SELECT action, enforced FROM fraud_decisions WHERE idempotency_key = ?",
      ["fraud-shadow-1"]
    );
    expect(row?.action).toBe("block");
    expect(row?.enforced).toBe(0); // recorded, not enforced
  });

  it("an unfunded transfer surfaces INSUFFICIENT_FUNDS, not fraud", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");
    const { getDb } = await import("../src/db");

    await expect(
      transfer({
        fromUserId: carol,
        toUserId: dave,
        amountMinor: 99_999_999n, // way over balance
        currency: "USD",
        idempotencyKey: "fraud-unfunded-1",
      })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });

    // No decision recorded — screening was skipped for the unfunded attempt.
    const row = await getDb().queryOne(
      "SELECT id FROM fraud_decisions WHERE idempotency_key = ?",
      ["fraud-unfunded-1"]
    );
    expect(row).toBeNull();
  });
});
