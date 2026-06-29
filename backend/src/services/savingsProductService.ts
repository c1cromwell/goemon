/**
 * Phase 24.9 — Borderless savings (adult USDC savings, self-accrual — no partner bank required).
 *
 * Yield is funded from the ledger `interest_source` system account (disclosed simulated APY).
 * Not FDIC-insured — standalone go-live path before partner-bank HYSA.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { dailyAccrualAmount } from "./interestAccrualService";
import {
  getBalance,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  getUserBalances,
  postJournal,
} from "./ledgerService";

const DEFAULT_CURRENCY = "USDC";

function assertBorderlessSavings(): void {
  if (!config.BORDERLESS_SAVINGS_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Borderless savings is not enabled");
  }
}

export interface SavingsEnrollment {
  userId: string;
  currency: string;
  apyBps: number;
  enrolledAt: string;
}

export async function enrollBorderlessSavings(userId: string, currency = DEFAULT_CURRENCY): Promise<SavingsEnrollment> {
  assertBorderlessSavings();
  const apyBps = config.SAVINGS_APY_BPS;
  const now = new Date().toISOString();
  const existing = await getDb().queryOne<{ user_id: string; currency: string; apy_bps: number; enrolled_at: string }>(
    "SELECT user_id, currency, apy_bps, enrolled_at FROM savings_product_enrollments WHERE user_id = ?",
    [userId]
  );
  if (existing) {
    return { userId, currency: existing.currency, apyBps: existing.apy_bps, enrolledAt: existing.enrolled_at };
  }
  await getOrCreateUserAccount(userId, "user_savings", currency);
  await getDb().execute(
    `INSERT INTO savings_product_enrollments (user_id, currency, apy_bps, enrolled_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, currency, apyBps, now, now]
  );
  await logAudit({ userId, action: "savings.borderless.enroll", resource: userId, details: { currency, apyBps } });
  return { userId, currency, apyBps, enrolledAt: now };
}

export async function getEnrollment(userId: string): Promise<SavingsEnrollment | null> {
  const row = await getDb().queryOne<{ user_id: string; currency: string; apy_bps: number; enrolled_at: string }>(
    "SELECT user_id, currency, apy_bps, enrolled_at FROM savings_product_enrollments WHERE user_id = ?",
    [userId]
  );
  if (!row) return null;
  return { userId: row.user_id, currency: row.currency, apyBps: row.apy_bps, enrolledAt: row.enrolled_at };
}

export async function depositToSavings(userId: string, amountMinor: bigint, idempotencyKey: string): Promise<{ journalId: string }> {
  assertBorderlessSavings();
  await enrollBorderlessSavings(userId);
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  const enrollment = (await getEnrollment(userId))!;
  const cashId = await getOrCreateUserAccount(userId, "user_cash", enrollment.currency);
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", enrollment.currency);
  if ((await getBalance(cashId)) < amountMinor) {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient cash balance");
  }
  const journalId = await postJournal(
    [
      { ledgerAccountId: cashId, direction: "debit", amountMinor, currency: enrollment.currency },
      { ledgerAccountId: savingsId, direction: "credit", amountMinor, currency: enrollment.currency },
    ],
    "Borderless savings deposit",
    { idempotencyKey: `savings:deposit:${idempotencyKey}` }
  );
  await logAudit({ userId, action: "savings.borderless.deposit", resource: journalId, details: { amountMinor: amountMinor.toString() } });
  return { journalId };
}

export async function withdrawFromSavings(userId: string, amountMinor: bigint, idempotencyKey: string): Promise<{ journalId: string }> {
  assertBorderlessSavings();
  const enrollment = await getEnrollment(userId);
  if (!enrollment) throw new AppError(ErrorCode.NOT_FOUND, "Not enrolled in borderless savings");
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  const cashId = await getOrCreateUserAccount(userId, "user_cash", enrollment.currency);
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", enrollment.currency);
  if ((await getBalance(savingsId)) < amountMinor) {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient savings balance");
  }
  const journalId = await postJournal(
    [
      { ledgerAccountId: savingsId, direction: "debit", amountMinor, currency: enrollment.currency },
      { ledgerAccountId: cashId, direction: "credit", amountMinor, currency: enrollment.currency },
    ],
    "Borderless savings withdraw",
    { idempotencyKey: `savings:withdraw:${idempotencyKey}` }
  );
  await logAudit({ userId, action: "savings.borderless.withdraw", resource: journalId, details: { amountMinor: amountMinor.toString() } });
  return { journalId };
}

export async function accrueBorderlessDaily(userId: string, period: string): Promise<{ accruedMinor: string } | null> {
  assertBorderlessSavings();
  const enrollment = await getEnrollment(userId);
  if (!enrollment) return null;
  const existing = await getDb().queryOne("SELECT id FROM interest_accruals WHERE user_id = ? AND period = ?", [userId, period]);
  if (existing) return null;

  const balances = await getUserBalances(userId);
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", enrollment.currency);
  const basis = await getBalance(savingsId);
  const accrued = dailyAccrualAmount(basis, enrollment.apyBps);
  if (accrued <= 0n) return null;

  const sourceId = await getOrCreateSystemAccount("interest_source", enrollment.currency);
  const journalId = await postJournal(
    [
      { ledgerAccountId: sourceId, direction: "debit", amountMinor: accrued, currency: enrollment.currency },
      { ledgerAccountId: savingsId, direction: "credit", amountMinor: accrued, currency: enrollment.currency },
    ],
    `Borderless interest ${period}`,
    { idempotencyKey: `savings:interest:${userId}:${period}` }
  );

  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO interest_accruals (id, user_id, period, apy_bps, balance_basis_minor, accrued_minor, journal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, period, enrollment.apyBps, basis.toString(), accrued.toString(), journalId, new Date().toISOString()]
  );
  return { accruedMinor: accrued.toString() };
}

export async function getBorderlessSummary(userId: string): Promise<{
  enrolled: boolean;
  currency: string;
  apyBps: number;
  cashMinor: string;
  savingsMinor: string;
  disclosure: string;
}> {
  const enrollment = await getEnrollment(userId);
  const currency = enrollment?.currency ?? DEFAULT_CURRENCY;
  const balances = await getUserBalances(userId, currency);
  return {
    enrolled: !!enrollment,
    currency,
    apyBps: enrollment?.apyBps ?? config.SAVINGS_APY_BPS,
    cashMinor: balances.cash.toString(),
    savingsMinor: balances.savings.toString(),
    disclosure:
      "Yield is paid from the platform interest pool; not FDIC-insured. Partner-bank savings is a separate SKU when BANK_RAILS_ENABLED.",
  };
}
