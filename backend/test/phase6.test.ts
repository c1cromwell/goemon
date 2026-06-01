/**
 * Phase 6 — SmartChat (RFC 8693 token exchange) tests.
 *
 * Verifies:
 *   1. The simulated classifier maps messages → operations and parses amounts in
 *      integer minor units (no float).
 *   2. A read intent (balance) issues a token and executes immediately.
 *   3. A transfer at/below $500 executes immediately via ledgerService.transfer
 *      (sender debited, recipient credited).
 *   4. A transfer over $500 requires MFA: it does NOT execute until the code is
 *      submitted, then it executes exactly once.
 *   5. A wrong MFA code is rejected.
 *   6. Re-executing an already-executed token returns the stored result and does
 *      NOT double-post to the ledger (idempotent on operation-token id).
 *   7. An expired operation token cannot execute.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-phase6-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.SMARTCHAT_ORCHESTRATOR = "simulated";
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
// Intent classification
// ---------------------------------------------------------------------------

describe("Phase 6: simulated intent classifier", () => {
  it("parses money strings into integer minor units without float", async () => {
    const { parseAmountMinor } = await import("../src/utils/smartchatModel");
    expect(parseAmountMinor("$1,234.56")).toBe(123456n);
    expect(parseAmountMinor("send 500")).toBe(50000n);
    expect(parseAmountMinor("$0.07")).toBe(7n);
    expect(parseAmountMinor("$10.5")).toBe(1050n);
    expect(parseAmountMinor("no money here")).toBeNull();
  });

  it("classifies balance / transactions / transfer / chat", async () => {
    const { classifyIntentSimulated } = await import("../src/utils/smartchatModel");
    expect(classifyIntentSimulated("what's my balance?").operation).toBe("balance.read");
    expect(classifyIntentSimulated("show my recent transactions").operation).toBe("transactions.read");

    const t = classifyIntentSimulated("send $50 to alex@example.com");
    expect(t.operation).toBe("transfer.send");
    expect(t.amountMinor).toBe("5000");
    expect(t.recipient).toBe("alex@example.com");

    expect(classifyIntentSimulated("hello there").operation).toBe("chat");
  });
});

// ---------------------------------------------------------------------------
// Read intent — immediate execution
// ---------------------------------------------------------------------------

describe("Phase 6: balance read", () => {
  let userId: string;

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const u = await createUser("sc-bal@test.com", "Balance User");
    userId = u.id;
    await getOrCreateUserAccount(userId, "user_cash", "USD"); // seeds $10,000 opening balance
  });

  it("issues a token and executes the read immediately", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const res = await handleMessage({ userId, message: "what is my balance?" });
    expect(res.requiresMfa).toBe(false);
    expect(res.intent.operation).toBe("balance.read");
    expect(res.operationToken?.status).toBe("executed");
    expect(res.reply).toContain("10000.00 USD");
  });

  it("chat intent issues no operation token", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const res = await handleMessage({ userId, message: "hi, who are you?" });
    expect(res.operationToken).toBeNull();
    expect(res.requiresMfa).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transfer below the MFA threshold — immediate execution via the ledger
// ---------------------------------------------------------------------------

describe("Phase 6: transfer at/below $500 (no MFA)", () => {
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const alice = await createUser("sc-alice@test.com", "Alice");
    const bob = await createUser("sc-bob@test.com", "Bob");
    aliceId = alice.id;
    bobId = bob.id;
    await getOrCreateUserAccount(aliceId, "user_cash", "USD");
    await getOrCreateUserAccount(bobId, "user_cash", "USD");
  });

  it("executes immediately and moves money through the ledger", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const aliceBefore = await getUserBalances(aliceId);
    const bobBefore = await getUserBalances(bobId);

    const res = await handleMessage({ userId: aliceId, message: "send $100 to sc-bob@test.com" });
    expect(res.requiresMfa).toBe(false);
    expect(res.operationToken?.status).toBe("executed");

    const aliceAfter = await getUserBalances(aliceId);
    const bobAfter = await getUserBalances(bobId);
    expect(aliceAfter.cash).toBe(aliceBefore.cash - 10_000n);
    expect(bobAfter.cash).toBe(bobBefore.cash + 10_000n);
  });

  it("rejects a transfer to an unknown recipient", async () => {
    const { handleMessage } = await import("../src/services/smartchatService");
    await expect(
      handleMessage({ userId: aliceId, message: "send $5 to nobody@nowhere.com" })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Transfer above the MFA threshold — MFA gate
// ---------------------------------------------------------------------------

describe("Phase 6: transfer over $500 (MFA required)", () => {
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const alice = await createUser("sc-alice2@test.com", "Alice2");
    const bob = await createUser("sc-bob2@test.com", "Bob2");
    aliceId = alice.id;
    bobId = bob.id;
    await getOrCreateUserAccount(aliceId, "user_cash", "USD");
    await getOrCreateUserAccount(bobId, "user_cash", "USD");
  });

  it("does not execute until the MFA code is submitted, then executes once", async () => {
    const { handleMessage, verifyMfaAndExecute } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const aliceBefore = await getUserBalances(aliceId);

    const issued = await handleMessage({ userId: aliceId, message: "send $600 to sc-bob2@test.com" });
    expect(issued.requiresMfa).toBe(true);
    expect(issued.operationToken?.status).toBe("awaiting_mfa");
    expect(issued.devMfaCode).toBeTruthy();

    // Money must NOT have moved yet.
    const aliceMid = await getUserBalances(aliceId);
    expect(aliceMid.cash).toBe(aliceBefore.cash);

    const confirmed = await verifyMfaAndExecute({
      userId: aliceId,
      tokenId: issued.operationToken!.id,
      code: issued.devMfaCode!,
    });
    expect(confirmed.operationToken?.status).toBe("executed");

    const aliceAfter = await getUserBalances(aliceId);
    expect(aliceAfter.cash).toBe(aliceBefore.cash - 60_000n);
  });

  it("rejects a wrong MFA code", async () => {
    const { handleMessage, verifyMfaAndExecute } = await import("../src/services/smartchatService");
    const issued = await handleMessage({ userId: aliceId, message: "send $700 to sc-bob2@test.com" });
    await expect(
      verifyMfaAndExecute({ userId: aliceId, tokenId: issued.operationToken!.id, code: "000000" })
    ).rejects.toThrow();
    // The token is still awaiting MFA, not executed.
    const { getOperationToken } = await import("../src/services/smartchatService");
    const tok = await getOperationToken(aliceId, issued.operationToken!.id);
    expect(tok.status).toBe("awaiting_mfa");
  });
});

// ---------------------------------------------------------------------------
// Idempotency + expiry
// ---------------------------------------------------------------------------

describe("Phase 6: idempotency and expiry", () => {
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const alice = await createUser("sc-alice3@test.com", "Alice3");
    const bob = await createUser("sc-bob3@test.com", "Bob3");
    aliceId = alice.id;
    bobId = bob.id;
    await getOrCreateUserAccount(aliceId, "user_cash", "USD");
    await getOrCreateUserAccount(bobId, "user_cash", "USD");
  });

  it("re-executing an executed token returns the stored result and does not double-post", async () => {
    const { handleMessage, executeOperationToken } = await import("../src/services/smartchatService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const res = await handleMessage({ userId: aliceId, message: "send $25 to sc-bob3@test.com" });
    const tokenId = res.operationToken!.id;
    const afterFirst = await getUserBalances(aliceId);

    const replay = await executeOperationToken(aliceId, tokenId);
    expect((replay as { amount_minor: string }).amount_minor).toBe("2500");

    const afterReplay = await getUserBalances(aliceId);
    expect(afterReplay.cash).toBe(afterFirst.cash); // no second debit
  });

  it("rejects execution of an expired operation token", async () => {
    const { handleMessage, executeOperationToken } = await import("../src/services/smartchatService");
    const { getDb } = await import("../src/db");

    // Issue a read token, then force it past its expiry.
    const res = await handleMessage({ userId: aliceId, message: "what's my balance" });
    // Reset to pending and expire it so we hit the expiry branch, not the
    // already-executed branch.
    const past = new Date(Date.now() - 1000).toISOString();
    await getDb().execute(
      "UPDATE operation_tokens SET status = 'pending', result = NULL, used_at = NULL, expires_at = ? WHERE id = ?",
      [past, res.operationToken!.id]
    );

    await expect(executeOperationToken(aliceId, res.operationToken!.id)).rejects.toThrow();
  });
});
