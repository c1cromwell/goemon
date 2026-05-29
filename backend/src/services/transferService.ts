/**
 * Phase 4 — Transfer service.
 *
 * Executes user-to-user transfers via the double-entry ledger.
 * The balance check and journal post happen inside one transaction so there is
 * no TOCTOU window between "check" and "post".
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import {
  getOrCreateUserAccount,
  getBalance,
  postJournal,
} from "./ledgerService";

export interface TransferInput {
  fromUserId: string;
  toUserId: string;
  amountMinor: bigint;
  currency: string;
  description?: string;
  idempotencyKey: string;
}

export interface TransferResult {
  journalId: string;
  transactionId: string;
}

export async function transfer(input: TransferInput): Promise<TransferResult> {
  if (input.amountMinor <= 0n) {
    throw new AppError(ErrorCode.VALIDATION, "Transfer amount must be positive");
  }
  if (input.currency !== "USD" && input.currency !== "USDC") {
    throw new AppError(ErrorCode.VALIDATION, "Unsupported currency");
  }

  const db = getDb();

  // Verify recipient exists before touching any ledger accounts (C-2).
  const toUser = await db.queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [input.toUserId]);
  if (!toUser) throw new AppError(ErrorCode.NOT_FOUND, "Recipient not found");

  const fromAccountId = await getOrCreateUserAccount(input.fromUserId, "user_cash", input.currency);
  const toAccountId = await getOrCreateUserAccount(input.toUserId, "user_cash", input.currency);

  const ledgerKey = `transfer:${input.idempotencyKey}`;

  return db.transaction(async (tx) => {
    // Idempotency check inside the transaction eliminates the TOCTOU race (C-4).
    const existingJournal = await tx.queryOne<{ id: string }>(
      "SELECT id FROM ledger_journals WHERE idempotency_key = ?",
      [ledgerKey]
    );
    if (existingJournal) {
      const existingTx = await tx.queryOne<{ id: string }>(
        "SELECT id FROM transactions WHERE journal_id = ? AND user_id = ? AND type = 'transfer_out'",
        [existingJournal.id, input.fromUserId]
      );
      return { journalId: existingJournal.id, transactionId: existingTx?.id ?? existingJournal.id };
    }

    // Balance check inside the transaction — no TOCTOU for concurrent requests.
    const balance = await getBalance(fromAccountId, tx);
    if (balance < input.amountMinor) {
      throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");
    }

    const desc = input.description ?? `Transfer to user ${input.toUserId}`;
    const journalId = await postJournal(
      [
        { ledgerAccountId: fromAccountId, direction: "debit", amountMinor: input.amountMinor, currency: input.currency },
        { ledgerAccountId: toAccountId, direction: "credit", amountMinor: input.amountMinor, currency: input.currency },
      ],
      desc,
      { idempotencyKey: ledgerKey, db: tx }
    );

    const txId = uuidv4();
    const now = new Date().toISOString();

    await tx.execute(
      `INSERT INTO transactions (id, user_id, journal_id, from_account_id, to_account_id, amount_minor, currency, description, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'transfer_out', 'completed', ?)`,
      [txId, input.fromUserId, journalId, fromAccountId, toAccountId, input.amountMinor, input.currency, desc, now]
    );
    await tx.execute(
      `INSERT INTO transactions (id, user_id, journal_id, from_account_id, to_account_id, amount_minor, currency, description, type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'transfer_in', 'completed', ?)`,
      [uuidv4(), input.toUserId, journalId, fromAccountId, toAccountId, input.amountMinor, input.currency, desc, now]
    );

    await logAudit({
      userId: input.fromUserId,
      action: "transfer",
      resource: journalId,
      details: {
        toUserId: input.toUserId,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      },
    });

    return { journalId, transactionId: txId };
  });
}

export async function getTransactionHistory(
  userId: string,
  limit = 50
): Promise<{ id: string; journalId: string; type: string; amountMinor: string; currency: string; description: string; createdAt: string }[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<{
    id: string;
    journal_id: string;
    type: string;
    amount_minor: string | number;
    currency: string;
    description: string;
    created_at: string;
  }>(
    `SELECT id, journal_id, type, amount_minor, currency, description, created_at
     FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, capped]
  );
  return rows.map((r) => ({
    id: r.id,
    journalId: r.journal_id,
    type: r.type,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    description: r.description,
    createdAt: r.created_at,
  }));
}
