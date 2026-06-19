/**
 * Phase 22.3 — teen money coach (read / recommend / draft; never executes money).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { getProfile } from "./identityService";
import { listGoals, getSavingsOverview } from "./savingsGoalService";
import { getTeenSpendSummary } from "./teenSpendService";
import { listAuthorizations } from "./cardService";

function assertStarter(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Argus Starter is currently unavailable");
}

export interface CoachInsightRow {
  id: string;
  teen_user_id: string;
  guardian_user_id: string;
  insight_type: string;
  summary: string;
  payload: string;
  created_at: string;
}

async function persistInsight(
  teenUserId: string,
  guardianUserId: string,
  insightType: string,
  summary: string,
  payload: Record<string, unknown>
): Promise<CoachInsightRow> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO coach_insights (id, teen_user_id, guardian_user_id, insight_type, summary, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, teenUserId, guardianUserId, insightType, summary, JSON.stringify(payload), now]
  );
  return (await getDb().queryOne<CoachInsightRow>("SELECT * FROM coach_insights WHERE id = ?", [id]))!;
}

export async function analyzeSpending(teenUserId: string): Promise<{ summary: string; topMerchants: string[]; insightId: string }> {
  assertStarter();
  const profile = await getProfile(teenUserId);
  if (!profile?.guardian_user_id) throw new AppError(ErrorCode.NOT_FOUND, "Teen not found");

  const auths = await listAuthorizations(teenUserId, 20);
  const merchants = auths
    .filter((a) => a.status === "authorized" || a.status === "captured")
    .map((a) => a.merchant ?? "unknown");
  const counts = new Map<string, number>();
  for (const m of merchants) counts.set(m, (counts.get(m) ?? 0) + 1);
  const topMerchants = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);

  const summary =
    auths.length === 0
      ? "No card spending yet — a great time to set a first savings goal."
      : `Recent spending at ${topMerchants.join(", ") || "various merchants"}. Review limits if any category feels high.`;

  const row = await persistInsight(teenUserId, profile.guardian_user_id, "spending_analysis", summary, { topMerchants, authCount: auths.length });
  return { summary, topMerchants, insightId: row.id };
}

export async function recommendSavingsGoal(teenUserId: string): Promise<{ recommendation: string; insightId: string }> {
  assertStarter();
  const profile = await getProfile(teenUserId);
  if (!profile?.guardian_user_id) throw new AppError(ErrorCode.NOT_FOUND, "Teen not found");

  const goals = await listGoals(teenUserId);
  const savings = await getSavingsOverview(teenUserId);
  const recommendation =
    goals.length === 0
      ? "Start with a small goal — $25 toward something you want in the next month builds the saving habit."
      : `You're tracking ${goals.length} goal(s). Consider moving $5–$10 from cash to savings this week.`;

  const row = await persistInsight(teenUserId, profile.guardian_user_id, "savings_recommendation", recommendation, {
    goalCount: goals.length,
    savingsMinor: savings.balances.savings,
  });
  return { recommendation, insightId: row.id };
}

export async function draftMoneyLesson(teenUserId: string, topic = "compound_interest"): Promise<{ draft: string; insightId: string }> {
  assertStarter();
  const profile = await getProfile(teenUserId);
  if (!profile?.guardian_user_id) throw new AppError(ErrorCode.NOT_FOUND, "Teen not found");

  const drafts: Record<string, string> = {
    compound_interest:
      "When you save, your money can earn interest — and then that interest earns more. Starting early, even with small amounts, adds up over years.",
    needs_vs_wants:
      "Before you buy, ask: do I need this now, or do I want it? Waiting 24 hours on wants helps avoid regret purchases.",
    credit_basics:
      "Good credit habits: pay on time and keep balances low. Your guardian-backed card is practice — treat it like real credit.",
  };
  const draft = drafts[topic] ?? drafts.compound_interest!;

  const row = await persistInsight(teenUserId, profile.guardian_user_id, "lesson_draft", draft, { topic });
  return { draft, insightId: row.id };
}

export async function getCoachNudge(teenUserId: string): Promise<{ nudge: string }> {
  const { policy, usage } = await getTeenSpendSummary(teenUserId);
  const remainingDaily = policy.dailyLimitMinor - usage.daily;
  if (remainingDaily <= 0n) {
    return { nudge: "You've hit today's spending limit — great time to check your savings goal instead." };
  }
  if (remainingDaily < 1_000n) {
    return { nudge: `Only ${remainingDaily} cents left in today's budget. Plan your next purchase carefully.` };
  }
  return { nudge: "You're on track today. Consider moving spare cash to savings before it disappears." };
}

export async function listCoachInsightsForGuardian(guardianUserId: string, teenUserId?: string): Promise<CoachInsightRow[]> {
  assertStarter();
  if (teenUserId) {
    return getDb().query<CoachInsightRow>(
      "SELECT * FROM coach_insights WHERE guardian_user_id = ? AND teen_user_id = ? ORDER BY created_at DESC LIMIT 20",
      [guardianUserId, teenUserId]
    );
  }
  return getDb().query<CoachInsightRow>(
    "SELECT * FROM coach_insights WHERE guardian_user_id = ? ORDER BY created_at DESC LIMIT 40",
    [guardianUserId]
  );
}

export async function getTeenCoachDashboard(teenUserId: string): Promise<{
  nudge: string;
  spending: Awaited<ReturnType<typeof analyzeSpending>>;
  savings: Awaited<ReturnType<typeof recommendSavingsGoal>>;
}> {
  const nudge = await getCoachNudge(teenUserId);
  const spending = await analyzeSpending(teenUserId);
  const savings = await recommendSavingsGoal(teenUserId);
  return { nudge: nudge.nudge, spending, savings };
}
