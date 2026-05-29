/**
 * Phase 4 — Double-entry ledger engine.
 *
 * Every monetary movement is a balanced journal: sum(credits) == sum(debits)
 * per currency across all entries. The balance of an account is derived by
 * querying ledger_entries — never from a mutable column.
 *
 * Account kinds:
 *   user_cash         — user's primary checking balance
 *   user_savings      — user's savings balance
 *   bank_settlement   — represents the partner bank's settlement pool (system)
 *   fee               — collected fees (system)
 *   external_clearing — ACH/wire holding (system)
 *
 * Opening balance: when a user_cash account is first created, a seed journal
 * is posted from bank_settlement → user_cash using the value from the accounts
 * table so ledger and legacy columns stay in sync.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, type Db } from "../db";
import { AppError, ErrorCode } from "../errors";

export interface LedgerEntryInput {
  ledgerAccountId: string;
  direction: "debit" | "credit";
  amountMinor: bigint;
  currency: string;
}

interface LedgerAccountRow {
  id: string;
  user_id: string | null;
  kind: string;
  currency: string;
}

// Throws if total credits != total debits for any currency group.
function assertBalanced(entries: LedgerEntryInput[]): void {
  const net = new Map<string, bigint>();
  for (const e of entries) {
    const cur = net.get(e.currency) ?? 0n;
    net.set(e.currency, e.direction === "credit" ? cur + e.amountMinor : cur - e.amountMinor);
  }
  for (const [currency, balance] of net) {
    if (balance !== 0n) {
      throw new AppError(
        ErrorCode.UNBALANCED_JOURNAL,
        `Journal is not balanced for ${currency}: net is ${balance}`
      );
    }
  }
}

/**
 * Post a balanced journal. Validates the balance invariant, then inserts the
 * journal + all entries atomically. Idempotent if idempotencyKey is provided.
 * Returns the journal id.
 */
export async function postJournal(
  entries: LedgerEntryInput[],
  description: string,
  opts?: { idempotencyKey?: string; externalRef?: string; db?: Db }
): Promise<string> {
  if (entries.length === 0) throw new AppError(ErrorCode.VALIDATION, "Journal must have at least one entry");
  assertBalanced(entries);

  const root = opts?.db ?? getDb();

  // Belt-and-suspenders idempotency: if a journal with this key was already
  // committed, return it without re-posting (HTTP idempotency middleware handles
  // the HTTP layer; this guards against in-process duplicate calls).
  if (opts?.idempotencyKey) {
    const existing = await root.queryOne<{ id: string }>(
      "SELECT id FROM ledger_journals WHERE idempotency_key = ?",
      [opts.idempotencyKey]
    );
    if (existing) return existing.id;
  }

  const now = new Date().toISOString();

  return root.transaction(async (tx) => {
    const journalId = uuidv4();
    await tx.execute(
      `INSERT INTO ledger_journals (id, idempotency_key, description, external_ref, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [journalId, opts?.idempotencyKey ?? null, description, opts?.externalRef ?? null, now]
    );
    for (const e of entries) {
      await tx.execute(
        `INSERT INTO ledger_entries (id, journal_id, ledger_account_id, direction, amount_minor, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), journalId, e.ledgerAccountId, e.direction, e.amountMinor, e.currency, now]
      );
    }
    return journalId;
  });
}

/** Balance of a ledger account (credits minus debits). Always exact. */
export async function getBalance(ledgerAccountId: string, db?: Db): Promise<bigint> {
  const root = db ?? getDb();
  const row = await root.queryOne<{ balance: string | number | null }>(
    `SELECT SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END) AS balance
     FROM ledger_entries WHERE ledger_account_id = ?`,
    [ledgerAccountId]
  );
  return BigInt(row?.balance ?? 0);
}

/**
 * Get or create a user's ledger account for the given kind/currency.
 * On first creation, posts an opening-balance journal from bank_settlement.
 */
export async function getOrCreateUserAccount(
  userId: string,
  kind: "user_cash" | "user_savings",
  currency: string,
  db?: Db
): Promise<string> {
  const root = db ?? getDb();

  const existing = await root.queryOne<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = ? AND currency = ?",
    [userId, kind, currency]
  );
  if (existing) return existing.id;

  // Wrap creation + seeding in a transaction so the account always has an
  // opening balance entry or none at all.
  return root.transaction(async (tx) => {
    // Double-check inside transaction (handles concurrent creation race).
    const existing2 = await tx.queryOne<{ id: string }>(
      "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = ? AND currency = ?",
      [userId, kind, currency]
    );
    if (existing2) return existing2.id;

    const accountId = uuidv4();
    await tx.execute(
      "INSERT INTO ledger_accounts (id, user_id, kind, currency, created_at) VALUES (?, ?, ?, ?, ?)",
      [accountId, userId, kind, currency, new Date().toISOString()]
    );

    // Seed opening balance from the legacy accounts table (USD only).
    // Non-USD currencies (USDC, etc.) have no legacy balance column; their
    // opening ledger balance is always 0 until funded by a deposit journal.
    const legacyRow =
      currency !== "USD"
        ? null
        : kind === "user_cash"
          ? await tx.queryOne<{ balance_minor: string | number }>(
              "SELECT balance_minor FROM accounts WHERE user_id = ?",
              [userId]
            )
          : await tx.queryOne<{ balance_minor: string | number }>(
              "SELECT balance_minor FROM savings_accounts WHERE user_id = ?",
              [userId]
            );

    const openingBalance = legacyRow ? BigInt(legacyRow.balance_minor) : 0n;

    if (openingBalance > 0n) {
      const systemId = await getSystemAccount("bank_settlement", currency, tx);
      await postJournal(
        [
          { ledgerAccountId: systemId, direction: "debit", amountMinor: openingBalance, currency },
          { ledgerAccountId: accountId, direction: "credit", amountMinor: openingBalance, currency },
        ],
        "Opening balance",
        { db: tx }
      );
    }

    return accountId;
  });
}

/** Return the id of a system ledger account (bank_settlement, fee, etc.). */
export async function getSystemAccount(kind: string, currency: string, db?: Db): Promise<string> {
  const root = db ?? getDb();
  const row = await root.queryOne<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE user_id IS NULL AND kind = ? AND currency = ?",
    [kind, currency]
  );
  if (!row) {
    throw new AppError(
      ErrorCode.INTERNAL,
      `System ledger account ${kind}/${currency} not found — run bootstrapSystemAccounts()`
    );
  }
  return row.id;
}

/** Ensure all required system ledger accounts exist. Call once on server boot. */
export async function bootstrapSystemAccounts(): Promise<void> {
  const db = getDb();
  const required = [
    { kind: "bank_settlement", currency: "USD" },
    { kind: "bank_settlement", currency: "USDC" },
    { kind: "fee", currency: "USD" },
    { kind: "external_clearing", currency: "USD" },
    { kind: "external_clearing", currency: "USDC" },
  ];

  for (const { kind, currency } of required) {
    const existing = await db.queryOne<{ id: string }>(
      "SELECT id FROM ledger_accounts WHERE user_id IS NULL AND kind = ? AND currency = ?",
      [kind, currency]
    );
    if (!existing) {
      await db.execute(
        "INSERT INTO ledger_accounts (id, user_id, kind, currency, created_at) VALUES (?, NULL, ?, ?, ?)",
        [uuidv4(), kind, currency, new Date().toISOString()]
      );
    }
  }
}

/** Cash and savings balances for a user, both derived from the ledger. */
export async function getUserBalances(userId: string, currency = "USD"): Promise<{ cash: bigint; savings: bigint }> {
  const cashId = await getOrCreateUserAccount(userId, "user_cash", currency);
  const cash = await getBalance(cashId);

  const savingsRow = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = 'user_savings' AND currency = ?",
    [userId, currency]
  );
  const savings = savingsRow ? await getBalance(savingsRow.id) : 0n;

  return { cash, savings };
}
