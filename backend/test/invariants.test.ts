/**
 * Phase 12/14 — executable security & money invariants.
 *
 * Complements the per-phase suites (presentation.test.ts already covers the VP
 * signature / replay / nonce / scope / grant invariants) with the cross-cutting
 * ones: money is integer-minor (no float columns), balances derive from balanced
 * journals, money mutations are idempotent on replay, the per-agent MCP limiter
 * trips, and the observability counters actually increment.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

const TMP_DB = `./data/test-invariants-${Date.now()}.db`;

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
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

let seq = 0;
async function makeFundedUser() {
  const { createUser } = await import("../src/services/authService");
  return createUser(`inv-${seq++}-${Date.now()}@test.com`, "Inv User"); // $10,000 opening balance
}

async function counterValue(counter: { get: () => Promise<{ values: Array<{ value: number; labels: Record<string, string> }> }> }, label: string): Promise<number> {
  const m = await counter.get();
  return m.values.filter((v) => v.labels.result === label).reduce((s, v) => s + v.value, 0);
}

// ---------------------------------------------------------------------------

describe("MONEY: integer minor units only", () => {
  it("no money column is declared as a floating type in any migration", () => {
    const dir = join(__dirname, "../src/db/migrations");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

    // A money-ish column (amount/balance/price/fee/gross/net/micro/_minor) must
    // never use REAL/FLOAT/DOUBLE/DECIMAL/NUMERIC. (Non-money REALs like
    // pii_confidence / risk_score are allowed.)
    const floatMoney = new RegExp(
      String.raw`\b\w*(amount|balance|price|fee|gross|net|micro|_minor)\w*\s+(REAL|FLOAT|DOUBLE|DECIMAL|NUMERIC)`,
      "i"
    );
    expect(sql).not.toMatch(floatMoney);
    // And there is at least one *_minor INTEGER column (sanity that the scan saw schema).
    expect(sql).toMatch(/_minor\s+INTEGER/i);
  });

  it("Money is exact (no float rounding)", async () => {
    const { Money } = await import("../src/db/money");
    const sum = Money.of(10n, "USD").amount + Money.of(20n, "USD").amount;
    expect(sum).toBe(30n); // 0.10 + 0.20 == 0.30 exactly, as integer cents
    expect(typeof Money.of(1n, "USD").amount).toBe("bigint");
  });
});

describe("LEDGER: balances derive from balanced journals", () => {
  it("rejects an unbalanced journal (debits != credits)", async () => {
    const { postJournal, getOrCreateUserAccount, getSystemAccount } = await import("../src/services/ledgerService");
    const u = await makeFundedUser();
    const userAcct = await getOrCreateUserAccount(u.id, "user_cash", "USD");
    const settlement = await getSystemAccount("bank_settlement", "USD");
    await expect(
      postJournal(
        [
          { ledgerAccountId: userAcct, direction: "debit", amountMinor: 100n, currency: "USD" },
          { ledgerAccountId: settlement, direction: "credit", amountMinor: 50n, currency: "USD" },
        ],
        "deliberately unbalanced"
      )
    ).rejects.toMatchObject({ name: "AppError" });
  });
});

describe("IDEMPOTENCY: money mutations replay, never double-post", () => {
  it("replaying a transfer with the same key returns the original and debits once", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { getUserBalances } = await import("../src/services/ledgerService");
    const sender = await makeFundedUser();
    const recipient = await makeFundedUser();
    const key = `idem-${Date.now()}`;

    const r1 = await transfer({ fromUserId: sender.id, toUserId: recipient.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key });
    const r2 = await transfer({ fromUserId: sender.id, toUserId: recipient.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key });

    expect(r2.journalId).toBe(r1.journalId); // replay returns the original journal
    const { cash } = await getUserBalances(sender.id);
    expect(cash).toBe(1_000_000n - 2500n); // debited exactly once
  });
});

describe("RATE LIMITING: per-agent MCP limiter", () => {
  it("trips RATE_LIMITED past the per-agent window", async () => {
    const { agentRateLimit, resetAgentRateLimit } = await import("../src/middleware/rateLimit");
    const { ErrorCode } = await import("../src/errors");
    resetAgentRateLimit();
    const did = "did:simulator:agent-rl-test";
    for (let i = 0; i < 3; i++) agentRateLimit(did, 3); // 3 allowed
    expect(() => agentRateLimit(did, 3)).toThrowError(expect.objectContaining({ code: ErrorCode.RATE_LIMITED }));
  });
});

describe("OBSERVABILITY: counters increment", () => {
  it("ledger_post_total increases when a journal is posted", async () => {
    const { ledgerPostTotal } = await import("../src/observability/metrics");
    const { transfer } = await import("../src/services/transferService");
    const before = await counterValue(ledgerPostTotal, "posted");
    const sender = await makeFundedUser();
    const recipient = await makeFundedUser();
    await transfer({ fromUserId: sender.id, toUserId: recipient.id, amountMinor: 100n, currency: "USD", idempotencyKey: `m-${Date.now()}` });
    const after = await counterValue(ledgerPostTotal, "posted");
    expect(after).toBeGreaterThan(before);
  });
});
