/**
 * Phase 22.2 — savings goals, transfers, guardian match, round-ups.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { assertGuardianOfTeen } from "./householdService";
import { getProfile } from "./identityService";
import {
  getBalance,
  getOrCreateUserAccount,
  getUserBalances,
  postJournal,
} from "./ledgerService";

function assertStarter(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Goemon Starter is currently unavailable");
}

export interface SavingsSettingsRow {
  teen_user_id: string;
  guardian_user_id: string;
  apy_bps: number;
  guardian_match_bps: number;
  savings_locked: number;
  round_up_goal_id: string | null;
  updated_at: string;
}

export interface SavingsGoalRow {
  id: string;
  user_id: string;
  name: string;
  target_minor: string;
  allocated_minor: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function getOrCreateSavingsSettings(teenUserId: string, guardianUserId: string): Promise<SavingsSettingsRow> {
  const existing = await getDb().queryOne<SavingsSettingsRow>(
    "SELECT * FROM teen_savings_settings WHERE teen_user_id = ?",
    [teenUserId]
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO teen_savings_settings (teen_user_id, guardian_user_id, apy_bps, guardian_match_bps, savings_locked, updated_at)
     VALUES (?, ?, 400, 5000, 1, ?)`,
    [teenUserId, guardianUserId, now]
  );
  return (await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [teenUserId]))!;
}

export async function updateSavingsSettings(
  guardianUserId: string,
  teenUserId: string,
  input: { apyBps?: number; guardianMatchBps?: number; savingsLocked?: boolean; roundUpGoalId?: string | null }
): Promise<SavingsSettingsRow> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  await getOrCreateSavingsSettings(teenUserId, guardianUserId);
  const now = new Date().toISOString();
  const cur = await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [teenUserId]);
  await getDb().execute(
    `UPDATE teen_savings_settings SET
       apy_bps = ?, guardian_match_bps = ?, savings_locked = ?, round_up_goal_id = ?, updated_at = ?
     WHERE teen_user_id = ?`,
    [
      input.apyBps ?? cur!.apy_bps,
      input.guardianMatchBps ?? cur!.guardian_match_bps,
      input.savingsLocked === undefined ? cur!.savings_locked : input.savingsLocked ? 1 : 0,
      input.roundUpGoalId === undefined ? cur!.round_up_goal_id : input.roundUpGoalId,
      now,
      teenUserId,
    ]
  );
  return (await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [teenUserId]))!;
}

export async function createGoal(userId: string, name: string, targetMinor: bigint): Promise<SavingsGoalRow> {
  assertStarter();
  if (targetMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Target must be positive");
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO savings_goals (id, user_id, name, target_minor, allocated_minor, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '0', 'active', ?, ?)`,
    [id, userId, name.trim(), targetMinor.toString(), now, now]
  );
  await logAudit({ userId, action: "starter.goal.create", resource: id, details: { name, targetMinor: targetMinor.toString() } });
  return (await getDb().queryOne<SavingsGoalRow>("SELECT * FROM savings_goals WHERE id = ?", [id]))!;
}

export async function listGoals(userId: string): Promise<SavingsGoalRow[]> {
  return getDb().query<SavingsGoalRow>(
    "SELECT * FROM savings_goals WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC",
    [userId]
  );
}

/** Move cash → savings and optionally allocate to a goal. */
export async function depositToSavings(
  userId: string,
  amountMinor: bigint,
  goalId?: string,
  idempotencyKey?: string
): Promise<{ journalId: string }> {
  assertStarter();
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");

  const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", "USD");
  if ((await getBalance(cashId)) < amountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient cash");

  const journalId = await postJournal(
    [
      { ledgerAccountId: cashId, direction: "debit", amountMinor, currency: "USD" },
      { ledgerAccountId: savingsId, direction: "credit", amountMinor, currency: "USD" },
    ],
    goalId ? `Save to goal ${goalId}` : "Transfer to savings",
    { idempotencyKey: idempotencyKey ?? `save:${userId}:${Date.now()}` }
  );

  if (goalId) {
    const goal = await getDb().queryOne<SavingsGoalRow>("SELECT * FROM savings_goals WHERE id = ? AND user_id = ?", [goalId, userId]);
    if (!goal) throw new AppError(ErrorCode.NOT_FOUND, "Goal not found");
    const allocated = BigInt(goal.allocated_minor) + amountMinor;
    await getDb().execute(
      "UPDATE savings_goals SET allocated_minor = ?, updated_at = ? WHERE id = ?",
      [allocated.toString(), new Date().toISOString(), goalId]
    );
  }

  await logAudit({ userId, action: "starter.savings.deposit", resource: journalId, details: { amountMinor: amountMinor.toString(), goalId } });
  return { journalId };
}

/** Withdraw savings → cash; blocked when guardian-locked for minors. */
export async function withdrawFromSavings(userId: string, amountMinor: bigint, idempotencyKey?: string): Promise<{ journalId: string }> {
  assertStarter();
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");

  const profile = await getProfile(userId);
  if (profile?.account_type === "minor") {
    const settings = profile.guardian_user_id
      ? await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [userId])
      : null;
    if (settings?.savings_locked === 1) {
      throw new AppError(ErrorCode.FORBIDDEN, "Savings withdrawals require guardian approval");
    }
  }

  const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
  const savingsId = await getOrCreateUserAccount(userId, "user_savings", "USD");
  if ((await getBalance(savingsId)) < amountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient savings");

  const journalId = await postJournal(
    [
      { ledgerAccountId: savingsId, direction: "debit", amountMinor, currency: "USD" },
      { ledgerAccountId: cashId, direction: "credit", amountMinor, currency: "USD" },
    ],
    "Withdraw from savings",
    { idempotencyKey: idempotencyKey ?? `save:wd:${userId}:${Date.now()}` }
  );
  await logAudit({ userId, action: "starter.savings.withdraw", resource: journalId, details: { amountMinor: amountMinor.toString() } });
  return { journalId };
}

/** Guardian-funded match when teen saves (e.g. 50% match). */
export async function applyGuardianMatch(
  guardianUserId: string,
  teenUserId: string,
  savedAmountMinor: bigint,
  idempotencyKey: string
): Promise<{ matchMinor: bigint; journalId: string } | null> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  const settings = await getOrCreateSavingsSettings(teenUserId, guardianUserId);
  if (settings.guardian_match_bps <= 0) return null;

  const matchMinor = (savedAmountMinor * BigInt(settings.guardian_match_bps)) / 10_000n;
  if (matchMinor <= 0n) return null;

  const guardianCash = await getOrCreateUserAccount(guardianUserId, "user_cash", "USD");
  const teenSavings = await getOrCreateUserAccount(teenUserId, "user_savings", "USD");
  if ((await getBalance(guardianCash)) < matchMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient guardian funds for match");

  const journalId = await postJournal(
    [
      { ledgerAccountId: guardianCash, direction: "debit", amountMinor: matchMinor, currency: "USD" },
      { ledgerAccountId: teenSavings, direction: "credit", amountMinor: matchMinor, currency: "USD" },
    ],
    `Guardian match for teen save`,
    { idempotencyKey: `match:${idempotencyKey}` }
  );
  await logAudit({
    userId: guardianUserId,
    action: "starter.savings.guardian_match",
    resource: journalId,
    details: { teenUserId, matchMinor: matchMinor.toString(), savedAmountMinor: savedAmountMinor.toString() },
  });
  return { matchMinor, journalId };
}

/** Round up from a debit purchase amount to the configured goal. */
export async function processRoundUp(teenUserId: string, purchaseMinor: bigint, idempotencyKey: string): Promise<bigint> {
  assertStarter();
  const settings = await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [teenUserId]);
  if (!settings?.round_up_goal_id) return 0n;

  const remainder = purchaseMinor % 100n;
  const roundUp = remainder === 0n ? 0n : 100n - remainder;
  if (roundUp <= 0n) return 0n;

  const cashId = await getOrCreateUserAccount(teenUserId, "user_cash", "USD");
  if ((await getBalance(cashId)) < roundUp) return 0n;

  await depositToSavings(teenUserId, roundUp, settings.round_up_goal_id, `roundup:${idempotencyKey}`);
  return roundUp;
}

export async function getSavingsOverview(userId: string): Promise<{
  balances: { cash: string; savings: string };
  goals: SavingsGoalRow[];
  settings: SavingsSettingsRow | null;
}> {
  const balances = await getUserBalances(userId);
  const profile = await getProfile(userId);
  const settings =
    profile?.account_type === "minor"
      ? await getDb().queryOne<SavingsSettingsRow>("SELECT * FROM teen_savings_settings WHERE teen_user_id = ?", [userId])
      : null;
  return {
    balances: { cash: balances.cash.toString(), savings: balances.savings.toString() },
    goals: await listGoals(userId),
    settings,
  };
}
