/**
 * Phase 22.2 — savings interest accrual (simulated APY seam).
 *
 * Daily accrual from `interest_source` → user_savings, idempotent per (user, period).
 * Mirrors corporateActionService.distributeDividend idempotency pattern.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { interestAccrualTotal } from "../observability/metrics";
import {
  getBalance,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  getUserBalances,
  postJournal,
} from "./ledgerService";

function assertStarter(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Goemon Starter is currently unavailable");
}

/** Daily accrual amount: balance * apyBps / 10000 / 365 (integer floor). */
export function dailyAccrualAmount(balanceMinor: bigint, apyBps: number): bigint {
  if (balanceMinor <= 0n || apyBps <= 0) return 0n;
  return (balanceMinor * BigInt(apyBps)) / (10_000n * 365n);
}

export interface AccrualRow {
  id: string;
  user_id: string;
  period: string;
  apy_bps: number;
  balance_basis_minor: string;
  accrued_minor: string;
  journal_id: string | null;
  created_at: string;
}

export async function accrueDaily(userId: string, period: string, apyBps: number): Promise<AccrualRow | null> {
  assertStarter();
  const existing = await getDb().queryOne<AccrualRow>(
    "SELECT * FROM interest_accruals WHERE user_id = ? AND period = ?",
    [userId, period]
  );
  if (existing) return existing;

  const balances = await getUserBalances(userId);
  const basis = balances.savings;
  const accrued = dailyAccrualAmount(basis, apyBps);
  if (accrued <= 0n) {
    interestAccrualTotal.inc({ result: "skipped" });
    return null;
  }

  const sourceId = await getOrCreateSystemAccount("interest_source", "USD");
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", "USD");
  const journalId = await postJournal(
    [
      { ledgerAccountId: sourceId, direction: "debit", amountMinor: accrued, currency: "USD" },
      { ledgerAccountId: savingsId, direction: "credit", amountMinor: accrued, currency: "USD" },
    ],
    `Daily interest ${period}`,
    { idempotencyKey: `interest:${userId}:${period}` }
  );

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO interest_accruals (id, user_id, period, apy_bps, balance_basis_minor, accrued_minor, journal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, period, apyBps, basis.toString(), accrued.toString(), journalId, now]
  );
  interestAccrualTotal.inc({ result: "accrued" });
  await logAudit({
    userId,
    action: "starter.interest.accrued",
    resource: id,
    details: { period, accruedMinor: accrued.toString(), apyBps },
  });
  return (await getDb().queryOne<AccrualRow>("SELECT * FROM interest_accruals WHERE id = ?", [id]))!;
}

export async function accrueAllForHouseholdTeens(period: string): Promise<{ accrued: number; skipped: number }> {
  assertStarter();
  const teens = await getDb().query<{ teen_user_id: string; apy_bps: number }>(
    "SELECT teen_user_id, apy_bps FROM teen_savings_settings"
  );
  let accrued = 0;
  let skipped = 0;
  for (const t of teens) {
    const row = await accrueDaily(t.teen_user_id, period, t.apy_bps);
    if (row) accrued++;
    else skipped++;
  }
  return { accrued, skipped };
}

export async function listAccruals(userId: string, limit = 30): Promise<AccrualRow[]> {
  return getDb().query<AccrualRow>(
    "SELECT * FROM interest_accruals WHERE user_id = ? ORDER BY period DESC LIMIT ?",
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
}

export async function getSavingsBalance(userId: string): Promise<bigint> {
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", "USD");
  return getBalance(savingsId);
}
