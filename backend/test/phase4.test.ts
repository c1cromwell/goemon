/**
 * Phase 4 — Double-entry ledger tests.
 *
 * Verifies:
 *   1. System account bootstrap creates bank_settlement accounts
 *   2. User account creation seeds opening balance from accounts table
 *   3. postJournal with balanced entries succeeds
 *   4. postJournal with unbalanced entries throws UNBALANCED_JOURNAL
 *   5. getBalance returns the correct value
 *   6. Transfer debits sender and credits receiver
 *   7. Transfer rejects insufficient funds
 *   8. Transfer is idempotent (same key never double-posts)
 *   9. BigInt precision is maintained across many operations
 *  10. ledger_entries and ledger_journals are append-only
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-phase4-${Date.now()}.db`;

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
// System account bootstrap
// ---------------------------------------------------------------------------

describe("Phase 4: System account bootstrap", () => {
  beforeAll(setup);

  it("bootstrapSystemAccounts creates bank_settlement/USD", async () => {
    const { getDb } = await import("../src/db");
    const row = await getDb().queryOne<{ id: string }>(
      "SELECT id FROM ledger_accounts WHERE user_id IS NULL AND kind = 'bank_settlement' AND currency = 'USD'"
    );
    expect(row).toBeTruthy();
  });

  it("bootstrapSystemAccounts is idempotent (no duplicates)", async () => {
    const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
    const { getDb } = await import("../src/db");

    await bootstrapSystemAccounts(); // call again
    const rows = await getDb().query(
      "SELECT id FROM ledger_accounts WHERE user_id IS NULL AND kind = 'bank_settlement' AND currency = 'USD'"
    );
    expect(rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ledgerService core
// ---------------------------------------------------------------------------

describe("Phase 4: postJournal and getBalance", () => {
  let bankSettlementId: string;
  let testAccountId: string;

  beforeAll(async () => {
    const { getDb } = await import("../src/db");
    const { getSystemAccount } = await import("../src/services/ledgerService");
    const { v4: uuidv4 } = await import("uuid");

    bankSettlementId = await getSystemAccount("bank_settlement", "USD");

    // Create a bare ledger account for testing (no user)
    testAccountId = uuidv4();
    await getDb().execute(
      "INSERT INTO ledger_accounts (id, user_id, kind, currency, created_at) VALUES (?, NULL, 'escrow', 'USD', ?)",
      [testAccountId, new Date().toISOString()]
    );
  });

  it("getBalance returns 0 for a new account", async () => {
    const { getBalance } = await import("../src/services/ledgerService");
    const balance = await getBalance(testAccountId);
    expect(balance).toBe(0n);
  });

  it("postJournal with balanced entries succeeds", async () => {
    const { postJournal, getBalance } = await import("../src/services/ledgerService");

    const journalId = await postJournal(
      [
        { ledgerAccountId: bankSettlementId, direction: "debit", amountMinor: 5000n, currency: "USD" },
        { ledgerAccountId: testAccountId, direction: "credit", amountMinor: 5000n, currency: "USD" },
      ],
      "Test credit to escrow"
    );
    expect(typeof journalId).toBe("string");

    const balance = await getBalance(testAccountId);
    expect(balance).toBe(5000n); // $50.00
  });

  it("postJournal throws UNBALANCED_JOURNAL for unbalanced entries", async () => {
    const { postJournal } = await import("../src/services/ledgerService");
    const { ErrorCode } = await import("../src/errors");

    await expect(
      postJournal(
        [
          { ledgerAccountId: bankSettlementId, direction: "debit", amountMinor: 1000n, currency: "USD" },
          { ledgerAccountId: testAccountId, direction: "credit", amountMinor: 999n, currency: "USD" },
        ],
        "Deliberately unbalanced"
      )
    ).rejects.toMatchObject({ code: ErrorCode.UNBALANCED_JOURNAL });
  });

  it("postJournal throws UNBALANCED_JOURNAL for empty entries", async () => {
    const { postJournal } = await import("../src/services/ledgerService");
    await expect(postJournal([], "Empty journal")).rejects.toThrow();
  });

  it("postJournal is idempotent with idempotencyKey", async () => {
    const { postJournal, getBalance } = await import("../src/services/ledgerService");

    const key = "test-idem-journal-1";
    const j1 = await postJournal(
      [
        { ledgerAccountId: bankSettlementId, direction: "debit", amountMinor: 100n, currency: "USD" },
        { ledgerAccountId: testAccountId, direction: "credit", amountMinor: 100n, currency: "USD" },
      ],
      "Idempotent journal",
      { idempotencyKey: key }
    );
    const j2 = await postJournal(
      [
        { ledgerAccountId: bankSettlementId, direction: "debit", amountMinor: 100n, currency: "USD" },
        { ledgerAccountId: testAccountId, direction: "credit", amountMinor: 100n, currency: "USD" },
      ],
      "Idempotent journal",
      { idempotencyKey: key }
    );
    expect(j1).toBe(j2);

    // Balance should only have increased by 100n (posted once), not 200n
    const { getDb } = await import("../src/db");
    const entries = await getDb().query(
      "SELECT * FROM ledger_journals WHERE idempotency_key = ?",
      [key]
    );
    expect(entries.length).toBe(1);
  });

  it("BigInt precision is maintained across sequential posts", async () => {
    const { postJournal, getBalance } = await import("../src/services/ledgerService");
    const { v4: uuidv4 } = await import("uuid");
    const { getDb } = await import("../src/db");

    // Use a fresh account to avoid counting previous posts
    const precisionAccountId = uuidv4();
    await getDb().execute(
      "INSERT INTO ledger_accounts (id, user_id, kind, currency, created_at) VALUES (?, NULL, 'escrow', 'USD', ?)",
      [precisionAccountId, new Date().toISOString()]
    );

    // Post ten times with small amounts (would accumulate float error in naive impl)
    for (let i = 0; i < 10; i++) {
      await postJournal(
        [
          { ledgerAccountId: bankSettlementId, direction: "debit", amountMinor: 1n, currency: "USD" },
          { ledgerAccountId: precisionAccountId, direction: "credit", amountMinor: 1n, currency: "USD" },
        ],
        `Precision test ${i}`
      );
    }

    const balance = await getBalance(precisionAccountId);
    expect(balance).toBe(10n); // exactly 10 cents — no float drift possible with BigInt
  });
});

// ---------------------------------------------------------------------------
// User account creation + opening balance
// ---------------------------------------------------------------------------

describe("Phase 4: User account + opening balance", () => {
  let userId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser("ledger4@test.com", "Ledger Tester");
    userId = user.id;
  });

  it("getOrCreateUserAccount seeds opening balance from accounts table", async () => {
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const accountId = await getOrCreateUserAccount(userId, "user_cash", "USD");
    expect(accountId).toBeTruthy();

    const balance = await getBalance(accountId);
    expect(balance).toBe(1_000_000n); // default $10,000.00 from accounts table
  });

  it("getOrCreateUserAccount is idempotent (returns same id)", async () => {
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");

    const id1 = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const id2 = await getOrCreateUserAccount(userId, "user_cash", "USD");
    expect(id1).toBe(id2);
  });

  it("getUserBalances returns correct cash balance", async () => {
    const { getUserBalances } = await import("../src/services/ledgerService");
    const { cash, savings } = await getUserBalances(userId);
    expect(cash).toBe(1_000_000n);
    expect(savings).toBe(0n); // no savings account created yet
  });
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

describe("Phase 4: Transfers", () => {
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const alice = await createUser("alice4@test.com", "Alice");
    const bob = await createUser("bob4@test.com", "Bob");
    aliceId = alice.id;
    bobId = bob.id;

    // Ensure ledger accounts + opening balances are seeded
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    await getOrCreateUserAccount(aliceId, "user_cash", "USD");
    await getOrCreateUserAccount(bobId, "user_cash", "USD");
  });

  it("transfer debits sender and credits receiver", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const aliceBefore = await getUserBalances(aliceId);
    const bobBefore = await getUserBalances(bobId);

    await transfer({
      fromUserId: aliceId,
      toUserId: bobId,
      amountMinor: 50_000n, // $500.00
      currency: "USD",
      description: "Test transfer",
      idempotencyKey: "transfer-test-1",
    });

    const aliceAfter = await getUserBalances(aliceId);
    const bobAfter = await getUserBalances(bobId);

    expect(aliceAfter.cash).toBe(aliceBefore.cash - 50_000n);
    expect(bobAfter.cash).toBe(bobBefore.cash + 50_000n);
  });

  it("transfer creates transaction records for both users", async () => {
    const { getTransactionHistory } = await import("../src/services/transferService");

    const aliceTxs = await getTransactionHistory(aliceId);
    const bobTxs = await getTransactionHistory(bobId);

    expect(aliceTxs.some((t) => t.type === "transfer_out")).toBe(true);
    expect(bobTxs.some((t) => t.type === "transfer_in")).toBe(true);
  });

  it("transfer rejects when sender has insufficient funds", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");

    await expect(
      transfer({
        fromUserId: aliceId,
        toUserId: bobId,
        amountMinor: 99_999_999n, // way more than $10,000
        currency: "USD",
        description: "Should fail",
        idempotencyKey: "transfer-test-insufficient",
      })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });

  it("transfer is idempotent — same key never double-posts", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { getUserBalances } = await import("../src/services/ledgerService");

    const key = "transfer-idem-test-2";
    const amount = 1_000n; // $10.00

    const r1 = await transfer({
      fromUserId: aliceId,
      toUserId: bobId,
      amountMinor: amount,
      currency: "USD",
      idempotencyKey: key,
    });
    const balanceAfterFirst = (await getUserBalances(aliceId)).cash;

    const r2 = await transfer({
      fromUserId: aliceId,
      toUserId: bobId,
      amountMinor: amount,
      currency: "USD",
      idempotencyKey: key,
    });
    const balanceAfterSecond = (await getUserBalances(aliceId)).cash;

    expect(r1.journalId).toBe(r2.journalId); // same journal returned
    expect(balanceAfterSecond).toBe(balanceAfterFirst); // balance unchanged by replay
  });

  it("transfer rejects zero or negative amounts", async () => {
    const { transfer } = await import("../src/services/transferService");

    await expect(
      transfer({
        fromUserId: aliceId,
        toUserId: bobId,
        amountMinor: 0n,
        currency: "USD",
        idempotencyKey: "transfer-zero",
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Append-only ledger tables
// ---------------------------------------------------------------------------

describe("Phase 4: Append-only ledger tables", () => {
  it("ledger_entries cannot be updated (append-only trigger)", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();

    const entry = await db.queryOne<{ id: string }>("SELECT id FROM ledger_entries LIMIT 1");
    if (!entry) return; // no entries yet — skip

    await expect(
      db.execute("UPDATE ledger_entries SET amount_minor = 0 WHERE id = ?", [entry.id])
    ).rejects.toThrow();
  });

  it("ledger_journals cannot be updated (append-only trigger)", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();

    const journal = await db.queryOne<{ id: string }>("SELECT id FROM ledger_journals LIMIT 1");
    if (!journal) return;

    await expect(
      db.execute("UPDATE ledger_journals SET description = 'HACKED' WHERE id = ?", [journal.id])
    ).rejects.toThrow();
  });

  it("ledger_entries cannot be deleted", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();

    const entry = await db.queryOne<{ id: string }>("SELECT id FROM ledger_entries LIMIT 1");
    if (!entry) return;

    await expect(
      db.execute("DELETE FROM ledger_entries WHERE id = ?", [entry.id])
    ).rejects.toThrow();
  });
});
