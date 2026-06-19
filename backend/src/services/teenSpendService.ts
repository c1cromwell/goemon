/**
 * Phase 22.1 — teen debit spend controls + guardian approval queue.
 *
 * Spend-limit policy gate (daily/weekly/monthly + category + merchant blocks) runs
 * before teen_debit authorizations. Over-limit spends escalate to agent_reviews
 * (requires_role=guardian); guardian approves/denies via /api/starter/reviews.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getProfile } from "./identityService";
import { assertGuardianOfTeen } from "./householdService";
import { authorize as cardAuthorize, type CardAuthRow, type CardRow } from "./cardService";
import { placeHold, releaseHold } from "./accountHoldService";
import { teenSpendTotal } from "../observability/metrics";

export interface SpendPolicyRow {
  id: string;
  teen_user_id: string;
  guardian_user_id: string;
  daily_limit_minor: string;
  weekly_limit_minor: string;
  monthly_limit_minor: string;
  category_limits: string;
  blocked_merchants: string;
  created_at: string;
  updated_at: string;
}

export interface SpendPolicy {
  teenUserId: string;
  guardianUserId: string;
  dailyLimitMinor: bigint;
  weeklyLimitMinor: bigint;
  monthlyLimitMinor: bigint;
  categoryLimits: Record<string, string>;
  blockedMerchants: string[];
}

export interface SpendUsage {
  daily: bigint;
  weekly: bigint;
  monthly: bigint;
}

export interface GuardianReviewRow {
  id: string;
  run_id: string;
  workflow_run: string;
  skill: string;
  subject_user_id: string | null;
  status: string;
  requires_role: string;
  recommendation: string;
  reason: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
}

function assertStarter(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Argus Starter is currently unavailable");
}

function parsePolicy(row: SpendPolicyRow): SpendPolicy {
  return {
    teenUserId: row.teen_user_id,
    guardianUserId: row.guardian_user_id,
    dailyLimitMinor: BigInt(row.daily_limit_minor),
    weeklyLimitMinor: BigInt(row.weekly_limit_minor),
    monthlyLimitMinor: BigInt(row.monthly_limit_minor),
    categoryLimits: JSON.parse(row.category_limits || "{}") as Record<string, string>,
    blockedMerchants: JSON.parse(row.blocked_merchants || "[]") as string[],
  };
}

function periodStart(kind: "daily" | "weekly" | "monthly"): string {
  const d = new Date();
  if (kind === "daily") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  if (kind === "weekly") {
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const mon = new Date(d);
    mon.setDate(d.getDate() - diff);
    mon.setHours(0, 0, 0, 0);
    return mon.toISOString();
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

async function spentSince(teenUserId: string, since: string): Promise<bigint> {
  const rows = await getDb().query<{ amount_minor: string }>(
    `SELECT amount_minor FROM card_authorizations
     WHERE user_id = ? AND status IN ('authorized', 'captured') AND created_at >= ?`,
    [teenUserId, since]
  );
  return rows.reduce((sum, r) => sum + BigInt(r.amount_minor), 0n);
}

export async function getSpendUsage(teenUserId: string): Promise<SpendUsage> {
  return {
    daily: await spentSince(teenUserId, periodStart("daily")),
    weekly: await spentSince(teenUserId, periodStart("weekly")),
    monthly: await spentSince(teenUserId, periodStart("monthly")),
  };
}

export async function getOrCreatePolicy(teenUserId: string, guardianUserId: string): Promise<SpendPolicy> {
  const existing = await getDb().queryOne<SpendPolicyRow>(
    "SELECT * FROM teen_spend_policies WHERE teen_user_id = ?",
    [teenUserId]
  );
  if (existing) return parsePolicy(existing);

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO teen_spend_policies
       (id, teen_user_id, guardian_user_id, daily_limit_minor, weekly_limit_minor, monthly_limit_minor, category_limits, blocked_merchants, created_at, updated_at)
     VALUES (?, ?, ?, '5000', '15000', '50000', '{}', '[]', ?, ?)`,
    [id, teenUserId, guardianUserId, now, now]
  );
  return parsePolicy((await getDb().queryOne<SpendPolicyRow>("SELECT * FROM teen_spend_policies WHERE id = ?", [id]))!);
}

export async function updateSpendPolicy(
  guardianUserId: string,
  teenUserId: string,
  input: {
    dailyLimitMinor?: bigint;
    weeklyLimitMinor?: bigint;
    monthlyLimitMinor?: bigint;
    categoryLimits?: Record<string, string>;
    blockedMerchants?: string[];
  }
): Promise<SpendPolicy> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  const policy = await getOrCreatePolicy(teenUserId, guardianUserId);
  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE teen_spend_policies SET
       daily_limit_minor = ?, weekly_limit_minor = ?, monthly_limit_minor = ?,
       category_limits = ?, blocked_merchants = ?, updated_at = ?
     WHERE teen_user_id = ?`,
    [
      (input.dailyLimitMinor ?? policy.dailyLimitMinor).toString(),
      (input.weeklyLimitMinor ?? policy.weeklyLimitMinor).toString(),
      (input.monthlyLimitMinor ?? policy.monthlyLimitMinor).toString(),
      JSON.stringify(input.categoryLimits ?? policy.categoryLimits),
      JSON.stringify(input.blockedMerchants ?? policy.blockedMerchants),
      now,
      teenUserId,
    ]
  );
  await logAudit({
    userId: guardianUserId,
    action: "starter.spend_policy.update",
    resource: teenUserId,
    details: { teenUserId },
  });
  return parsePolicy((await getDb().queryOne<SpendPolicyRow>("SELECT * FROM teen_spend_policies WHERE teen_user_id = ?", [teenUserId]))!);
}

export type SpendGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: ErrorCode.SPEND_LIMIT_EXCEEDED }
  | { allowed: false; reason: string; code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED; requiresApproval: true };

export function evaluateSpendGate(
  policy: SpendPolicy,
  usage: SpendUsage,
  amountMinor: bigint,
  merchant?: string,
  category?: string
): SpendGateResult {
  const m = (merchant ?? "").trim().toLowerCase();
  for (const blocked of policy.blockedMerchants) {
    if (m.includes(blocked.trim().toLowerCase())) {
      return { allowed: false, reason: `Merchant blocked: ${blocked}`, code: ErrorCode.SPEND_LIMIT_EXCEEDED };
    }
  }
  if (category && policy.categoryLimits[category] !== undefined) {
    const cap = BigInt(policy.categoryLimits[category]!);
    if (amountMinor > cap) {
      return { allowed: false, reason: `Category ${category} limit exceeded`, code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED, requiresApproval: true };
    }
  }
  const projections = {
    daily: usage.daily + amountMinor,
    weekly: usage.weekly + amountMinor,
    monthly: usage.monthly + amountMinor,
  };
  if (projections.daily > policy.dailyLimitMinor) {
    return { allowed: false, reason: "Daily spend limit exceeded", code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED, requiresApproval: true };
  }
  if (projections.weekly > policy.weeklyLimitMinor) {
    return { allowed: false, reason: "Weekly spend limit exceeded", code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED, requiresApproval: true };
  }
  if (projections.monthly > policy.monthlyLimitMinor) {
    return { allowed: false, reason: "Monthly spend limit exceeded", code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED, requiresApproval: true };
  }
  return { allowed: true };
}

/** Called from cardService.authorize for teen_debit cards. Throws on hard block; returns on allow. */
export async function assertTeenSpendAllowed(input: {
  userId: string;
  card: CardRow;
  amountMinor: bigint;
  merchant?: string;
  category?: string;
  idempotencyKey: string;
}): Promise<void> {
  if (input.card.card_type !== "teen_debit") return;
  assertStarter();

  const profile = await getProfile(input.userId);
  if (!profile || profile.account_type !== "minor") {
    throw new AppError(ErrorCode.VALIDATION, "Teen debit card requires a minor account");
  }
  const guardianUserId = input.card.guardian_user_id ?? profile.guardian_user_id;
  if (!guardianUserId) throw new AppError(ErrorCode.VALIDATION, "Teen card missing guardian");

  const policy = await getOrCreatePolicy(input.userId, guardianUserId);
  const usage = await getSpendUsage(input.userId);
  const gate = evaluateSpendGate(policy, usage, input.amountMinor, input.merchant, input.category);

  if (gate.allowed) return;

  if (gate.code === ErrorCode.SPEND_LIMIT_EXCEEDED) {
    teenSpendTotal.inc({ result: "blocked" });
    throw new AppError(gate.code, gate.reason);
  }

  // Over-limit → queue guardian approval (idempotent on idempotency key).
  const prior = await getDb().queryOne<{ id: string; review_id: string | null; status: string }>(
    "SELECT id, review_id, status FROM teen_spend_requests WHERE idempotency_key = ?",
    [input.idempotencyKey]
  );
  if (prior?.status === "approved" && prior.review_id) {
    return; // already approved — authorize proceeds
  }
  if (prior?.status === "pending") {
    throw new AppError(ErrorCode.GUARDIAN_APPROVAL_REQUIRED, "Awaiting guardian approval for this purchase");
  }

  const reviewId = uuidv4();
  const requestId = uuidv4();
  const workflowRun = uuidv4();
  const now = new Date().toISOString();
  const recommendation = JSON.stringify({
    guardianUserId,
    teenUserId: input.userId,
    cardId: input.card.id,
    amountMinor: input.amountMinor.toString(),
    merchant: input.merchant ?? null,
    category: input.category ?? null,
    idempotencyKey: input.idempotencyKey,
  });

  await getDb().transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO agent_reviews
         (id, run_id, workflow_run, skill, subject_user_id, status, requires_role, recommendation, reason, created_at)
       VALUES (?, ?, ?, 'teen-spend-approval', ?, 'pending', 'guardian', ?, ?, ?)`,
      [reviewId, uuidv4(), workflowRun, input.userId, recommendation, gate.reason, now]
    );
    await tx.execute(
      `INSERT INTO teen_spend_requests
         (id, teen_user_id, guardian_user_id, review_id, card_id, amount_minor, currency, merchant, category, status, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        requestId,
        input.userId,
        guardianUserId,
        reviewId,
        input.card.id,
        input.amountMinor.toString(),
        input.card.currency,
        input.merchant ?? null,
        input.category ?? null,
        input.idempotencyKey,
        now,
      ]
    );
  });

  teenSpendTotal.inc({ result: "approval_queued" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.spend.approval_queued",
    resource: requestId,
    details: { teenUserId: input.userId, amountMinor: input.amountMinor.toString(), reviewId },
  });
  throw new AppError(ErrorCode.GUARDIAN_APPROVAL_REQUIRED, gate.reason);
}

export async function issueTeenDebitCard(guardianUserId: string, teenUserId: string): Promise<CardRow> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  if (!config.CARDS_ENABLED) throw new AppError(ErrorCode.CARDS_DISABLED, "Cards are currently unavailable");

  const { issueCard } = await import("./cardService");
  const card = await issueCard(teenUserId);
  await getDb().execute(
    "UPDATE cards SET card_type = 'teen_debit', guardian_user_id = ? WHERE id = ?",
    [guardianUserId, card.id]
  );
  await getOrCreatePolicy(teenUserId, guardianUserId);
  await logAudit({
    userId: guardianUserId,
    action: "starter.teen_card.issued",
    resource: card.id,
    details: { teenUserId },
  });
  return (await getDb().queryOne<CardRow>("SELECT * FROM cards WHERE id = ?", [card.id]))!;
}

export async function listGuardianReviews(guardianUserId: string): Promise<GuardianReviewRow[]> {
  assertStarter();
  return getDb().query<GuardianReviewRow>(
    `SELECT ar.* FROM agent_reviews ar
     INNER JOIN teen_spend_requests tsr ON tsr.review_id = ar.id
     WHERE tsr.guardian_user_id = ? AND ar.status = 'pending'
     ORDER BY ar.created_at ASC`,
    [guardianUserId]
  );
}

export async function resolveGuardianReview(
  guardianUserId: string,
  reviewId: string,
  decision: "approve" | "reject",
  reason?: string
): Promise<{ status: string; cardAuth?: CardAuthRow }> {
  assertStarter();
  const review = await getDb().queryOne<GuardianReviewRow>("SELECT * FROM agent_reviews WHERE id = ?", [reviewId]);
  if (!review) throw new AppError(ErrorCode.NOT_FOUND, "Review not found");
  if (review.status !== "pending") throw new AppError(ErrorCode.CONFLICT, "Review already resolved");
  if (review.skill !== "teen-spend-approval") throw new AppError(ErrorCode.FORBIDDEN, "Not a teen spend review");
  if (!review.requires_role.split(",").map((r) => r.trim()).includes("guardian")) {
    throw new AppError(ErrorCode.FORBIDDEN, "Guardian role required");
  }

  const request = await getDb().queryOne<{
    id: string;
    teen_user_id: string;
    guardian_user_id: string;
    card_id: string;
    amount_minor: string;
    merchant: string | null;
    category: string | null;
    idempotency_key: string;
  }>("SELECT * FROM teen_spend_requests WHERE review_id = ?", [reviewId]);
  if (!request || request.guardian_user_id !== guardianUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Not your approval queue item");
  }

  const now = new Date().toISOString();
  if (decision === "reject") {
    await getDb().execute(
      "UPDATE agent_reviews SET status = 'rejected', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?",
      [guardianUserId, reason ?? "guardian_denied", now, reviewId]
    );
    await getDb().execute(
      "UPDATE teen_spend_requests SET status = 'denied', decided_at = ? WHERE id = ?",
      [now, request.id]
    );
    teenSpendTotal.inc({ result: "denied" });
    await logAudit({
      userId: guardianUserId,
      action: "starter.spend.denied",
      resource: request.id,
      details: { teenUserId: request.teen_user_id, reviewId },
    });
    return { status: "rejected" };
  }

  // Approve → run the authorization (guardian override skips spend gate).
  const auth = await cardAuthorize({
    userId: request.teen_user_id,
    cardId: request.card_id,
    amountMinor: BigInt(request.amount_minor),
    merchant: request.merchant ?? undefined,
    category: request.category ?? undefined,
    idempotencyKey: request.idempotency_key,
    channel: "teen_debit",
    skipTeenSpendGate: true,
  });

  await getDb().execute(
    "UPDATE agent_reviews SET status = 'approved', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?",
    [guardianUserId, reason ?? "guardian_approved", now, reviewId]
  );
  await getDb().execute(
    "UPDATE teen_spend_requests SET status = 'approved', card_auth_id = ?, decided_at = ? WHERE id = ?",
    [auth.id, now, request.id]
  );
  teenSpendTotal.inc({ result: "approved" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.spend.approved",
    resource: request.id,
    details: { teenUserId: request.teen_user_id, cardAuthId: auth.id },
  });
  return { status: "approved", cardAuth: auth };
}

export async function guardianFreezeTeen(guardianUserId: string, teenUserId: string, reason: string): Promise<void> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  await placeHold({ userId: teenUserId, reason, source: "guardian" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.teen.freeze",
    resource: teenUserId,
    details: { reason },
  });
}

export async function guardianUnfreezeTeen(guardianUserId: string, teenUserId: string, reason: string): Promise<void> {
  assertStarter();
  await assertGuardianOfTeen(guardianUserId, teenUserId);
  await releaseHold({ userId: teenUserId, reason, source: "guardian" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.teen.unfreeze",
    resource: teenUserId,
    details: { reason },
  });
}

export async function getTeenSpendSummary(teenUserId: string): Promise<{ policy: SpendPolicy; usage: SpendUsage }> {
  assertStarter();
  const profile = await getProfile(teenUserId);
  if (!profile?.guardian_user_id) throw new AppError(ErrorCode.NOT_FOUND, "Teen profile not found");
  const policy = await getOrCreatePolicy(teenUserId, profile.guardian_user_id);
  return { policy, usage: await getSpendUsage(teenUserId) };
}
