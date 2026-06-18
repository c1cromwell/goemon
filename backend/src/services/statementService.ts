/**
 * Phase 19 Stage-1 — account statements (export).
 *
 * Derived entirely from the ledger (the single source of truth): opening balance is the
 * user_cash balance as of the window start, line items are the ledger entries in the
 * window, and closing = opening + net(window). Money is integer minor units throughout.
 */

import { getDb } from "../db";

export interface StatementLine {
  date: string;
  description: string;
  direction: "debit" | "credit";
  amountMinor: string;
  signedMinor: string; // credit positive, debit negative (effect on the cash balance)
}

export interface Statement {
  currency: string;
  from: string;
  to: string;
  openingMinor: string;
  closingMinor: string;
  lines: StatementLine[];
}

/** The user's user_cash ledger account id for a currency, or null if none yet. */
async function cashAccountId(userId: string, currency: string): Promise<string | null> {
  const row = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = 'user_cash' AND currency = ?",
    [userId, currency]
  );
  return row?.id ?? null;
}

async function balanceAsOf(accountId: string, beforeISO: string): Promise<bigint> {
  const row = await getDb().queryOne<{ balance: string | number | null }>(
    `SELECT SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END) AS balance
     FROM ledger_entries WHERE ledger_account_id = ? AND created_at < ?`,
    [accountId, beforeISO]
  );
  return BigInt(row?.balance ?? 0);
}

export async function getStatement(userId: string, fromISO: string, toISO: string, currency = "USD"): Promise<Statement> {
  const accountId = await cashAccountId(userId, currency);
  if (!accountId) {
    return { currency, from: fromISO, to: toISO, openingMinor: "0", closingMinor: "0", lines: [] };
  }

  const opening = await balanceAsOf(accountId, fromISO);
  const rows = await getDb().query<{ direction: "debit" | "credit"; amount_minor: string | number; created_at: string; description: string | null }>(
    `SELECT le.direction, le.amount_minor, le.created_at, lj.description
     FROM ledger_entries le JOIN ledger_journals lj ON le.journal_id = lj.id
     WHERE le.ledger_account_id = ? AND le.created_at >= ? AND le.created_at <= ?
     ORDER BY le.created_at ASC`,
    [accountId, fromISO, toISO]
  );

  let running = opening;
  const lines: StatementLine[] = rows.map((r) => {
    const amt = BigInt(r.amount_minor);
    const signed = r.direction === "credit" ? amt : -amt;
    running += signed;
    return {
      date: r.created_at,
      description: r.description ?? "",
      direction: r.direction,
      amountMinor: amt.toString(),
      signedMinor: signed.toString(),
    };
  });

  return {
    currency,
    from: fromISO,
    to: toISO,
    openingMinor: opening.toString(),
    closingMinor: running.toString(),
    lines,
  };
}
