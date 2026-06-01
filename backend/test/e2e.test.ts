/**
 * End-to-end validation — deterministic floor.
 *
 * This is the deterministic backbone the `e2e-validator` skill runs first (see
 * docs/E2E-VALIDATION.md). It exercises cross-JOURNEY behavior and the §4
 * cross-cutting invariants in-process (matching the per-phase test style), then
 * marks the journeys whose phases are not built yet as PENDING via it.todo.
 *
 * Scope today: J1–J5 paths that are implemented (auth/ledger/SmartChat). J6
 * (external agent OID4VP + MCP — Phase 7) and J7/J8 (marketplace — Phase 8) are
 * PENDING and are validated by the e2e-validator/bankai-mcp-test-harness skills
 * once those phases land.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-e2e-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.SMARTCHAT_ORCHESTRATOR = "simulated";

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// §4 cross-cutting invariants (deterministic floor)
// ---------------------------------------------------------------------------

describe("E2E §4: cross-cutting invariants", () => {
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const alice = await createUser("e2e-alice@test.com", "E2E Alice");
    const bob = await createUser("e2e-bob@test.com", "E2E Bob");
    aliceId = alice.id;
    bobId = bob.id;
    await getOrCreateUserAccount(aliceId, "user_cash", "USD");
    await getOrCreateUserAccount(bobId, "user_cash", "USD");
  });

  it("money is integer minor units (bigint), never float — and balances derive from the ledger (J4)", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const aliceBefore = await getUserBalances(aliceId);
    const bobBefore = await getUserBalances(bobId);
    expect(typeof aliceBefore.cash).toBe("bigint");

    await handleMessage({ userId: aliceId, message: "send $100 to e2e-bob@test.com" });

    const aliceAfter = await getUserBalances(aliceId);
    const bobAfter = await getUserBalances(bobId);
    expect(aliceAfter.cash).toBe(aliceBefore.cash - 10_000n);
    expect(bobAfter.cash).toBe(bobBefore.cash + 10_000n);
  });

  it("operation tokens are idempotent on token id — replay does not double-post (J5)", async () => {
    const { handleMessage, executeOperationToken } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const res = await handleMessage({ userId: aliceId, message: "send $25 to e2e-bob@test.com" });
    const tokenId = res.operationToken!.id;
    const afterFirst = await getUserBalances(aliceId);

    await executeOperationToken(aliceId, tokenId);
    const afterReplay = await getUserBalances(aliceId);
    expect(afterReplay.cash).toBe(afterFirst.cash); // no second debit
  });

  it("transfers over $500 require the MFA gate before executing (J5)", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const before = await getUserBalances(aliceId);
    const issued = await handleMessage({ userId: aliceId, message: "send $600 to e2e-bob@test.com" });
    expect(issued.requiresMfa).toBe(true);
    expect(issued.operationToken?.status).toBe("awaiting_mfa");

    // Money must not have moved on the MFA-gated token.
    const mid = await getUserBalances(aliceId);
    expect(mid.cash).toBe(before.cash);
  });

  it("ledger_entries are append-only — UPDATE is blocked by the DB trigger", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();
    const row = await db.queryOne<{ id: string }>("SELECT id FROM ledger_entries LIMIT 1");
    expect(row?.id).toBeTruthy();
    await expect(
      db.execute("UPDATE ledger_entries SET amount_minor = amount_minor WHERE id = ?", [row!.id])
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PENDING journeys — validated by the e2e-validator / bankai-mcp-test-harness
// skills once Phases 7–8 land (see docs/E2E-VALIDATION.md §3).
// ---------------------------------------------------------------------------

describe("E2E journeys pending phase build-out", () => {
  it.todo("J6: external agent OID4VP → VP signature verified before access → MCP scoped op (Phase 7)");
  it.todo("J7: marketplace subscribe (escrow) → hold → compliance-gated transfer rejection (Phase 8)");
  it.todo("J8: marketplace buy/sell — atomic USDC+asset+fee in one journal, or revert (Phase 8)");
});
