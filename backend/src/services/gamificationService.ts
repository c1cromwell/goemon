/**
 * Phase 22.3 — gamification (quests, streaks, badges, lessons, net-worth journey).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { gamificationEventTotal } from "../observability/metrics";
import { getUserBalances } from "./ledgerService";
import { listGoals } from "./savingsGoalService";
import { getProfile } from "./identityService";

function assertStarter(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Argus Starter is currently unavailable");
}

export const QUEST_DEFS = [
  { id: "verify", title: "Complete verification", description: "Finish your identity setup with your guardian." },
  { id: "first_goal", title: "Set your first goal", description: "Create a savings goal." },
  { id: "first_save", title: "Save your first dollar", description: "Move money into savings." },
  { id: "first_lesson", title: "Finish a money lesson", description: "Complete any lesson quiz." },
  { id: "round_ups", title: "Enable round-ups", description: "Ask your guardian to turn on round-ups." },
] as const;

export const LESSON_DEFS = [
  { id: "compound_interest", title: "Compound interest", questions: 3 },
  { id: "needs_vs_wants", title: "Needs vs wants", questions: 3 },
  { id: "credit_basics", title: "Credit basics", questions: 3 },
] as const;

export const BADGE_DEFS = [
  { id: "saved_100", title: "Saved $100", rule: "savings >= 10000 minor" },
  { id: "streak_4w", title: "4-week streak", rule: "check_in streak >= 28" },
  { id: "first_lesson", title: "Student", rule: "completed a lesson" },
] as const;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkIn(userId: string): Promise<{ streakType: string; currentCount: number }> {
  assertStarter();
  const streakType = "check_in";
  const today = todayDate();
  const row = await getDb().queryOne<{ id: string; current_count: number; last_tick_date: string | null }>(
    "SELECT id, current_count, last_tick_date FROM user_streaks WHERE user_id = ? AND streak_type = ?",
    [userId, streakType]
  );

  if (row?.last_tick_date === today) {
    return { streakType, currentCount: row.current_count };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const nextCount = row?.last_tick_date === yesterdayStr ? (row.current_count + 1) : 1;
  const now = new Date().toISOString();

  if (row) {
    await getDb().execute(
      "UPDATE user_streaks SET current_count = ?, last_tick_date = ?, updated_at = ? WHERE id = ?",
      [nextCount, today, now, row.id]
    );
  } else {
    await getDb().execute(
      `INSERT INTO user_streaks (id, user_id, streak_type, current_count, last_tick_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), userId, streakType, nextCount, today, now, now]
    );
  }

  await getDb().execute(
    "INSERT INTO user_streak_ticks (id, user_id, streak_type, tick_date, created_at) VALUES (?, ?, ?, ?, ?)",
    [uuidv4(), userId, streakType, today, now]
  );
  gamificationEventTotal.inc({ kind: "streak" });
  await maybeAwardBadges(userId);
  return { streakType, currentCount: nextCount };
}

export async function completeQuest(userId: string, questId: string): Promise<void> {
  assertStarter();
  if (!QUEST_DEFS.some((q) => q.id === questId)) throw new AppError(ErrorCode.NOT_FOUND, "Quest not found");
  const existing = await getDb().queryOne<{ status: string }>(
    "SELECT status FROM user_quest_progress WHERE user_id = ? AND quest_id = ?",
    [userId, questId]
  );
  if (existing?.status === "completed") return;

  const now = new Date().toISOString();
  if (existing) {
    await getDb().execute(
      "UPDATE user_quest_progress SET status = 'completed', completed_at = ? WHERE user_id = ? AND quest_id = ?",
      [now, userId, questId]
    );
  } else {
    await getDb().execute(
      `INSERT INTO user_quest_progress (id, user_id, quest_id, status, completed_at, created_at)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
      [uuidv4(), userId, questId, now, now]
    );
  }
  gamificationEventTotal.inc({ kind: "quest" });
  await logAudit({ userId, action: "starter.quest.complete", resource: questId });
}

export async function completeLesson(userId: string, lessonId: string, score: number): Promise<void> {
  assertStarter();
  if (!LESSON_DEFS.some((l) => l.id === lessonId)) throw new AppError(ErrorCode.NOT_FOUND, "Lesson not found");
  const now = new Date().toISOString();
  const existing = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM lesson_completions WHERE user_id = ? AND lesson_id = ?",
    [userId, lessonId]
  );
  if (existing) {
    await getDb().execute("UPDATE lesson_completions SET score = ?, completed_at = ? WHERE id = ?", [score, now, existing.id]);
  } else {
    await getDb().execute(
      "INSERT INTO lesson_completions (id, user_id, lesson_id, score, completed_at) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), userId, lessonId, score, now]
    );
  }
  gamificationEventTotal.inc({ kind: "lesson" });
  await completeQuest(userId, "first_lesson");
  await maybeAwardBadges(userId);
}

async function awardBadge(userId: string, badgeId: string): Promise<void> {
  const existing = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM user_badges WHERE user_id = ? AND badge_id = ?",
    [userId, badgeId]
  );
  if (existing) return;
  await getDb().execute(
    "INSERT INTO user_badges (id, user_id, badge_id, earned_at) VALUES (?, ?, ?, ?)",
    [uuidv4(), userId, badgeId, new Date().toISOString()]
  );
  gamificationEventTotal.inc({ kind: "badge" });
  await logAudit({ userId, action: "starter.badge.earned", resource: badgeId });
}

async function maybeAwardBadges(userId: string): Promise<void> {
  const balances = await getUserBalances(userId);
  if (balances.savings >= 10_000n) await awardBadge(userId, "saved_100");

  const streak = await getDb().queryOne<{ current_count: number }>(
    "SELECT current_count FROM user_streaks WHERE user_id = ? AND streak_type = 'check_in'",
    [userId]
  );
  if ((streak?.current_count ?? 0) >= 28) await awardBadge(userId, "streak_4w");

  const lesson = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM lesson_completions WHERE user_id = ? LIMIT 1",
    [userId]
  );
  if (lesson) await awardBadge(userId, "first_lesson");
}

export async function syncQuestProgress(userId: string): Promise<void> {
  const goals = await listGoals(userId);
  if (goals.length > 0) await completeQuest(userId, "first_goal");

  const balances = await getUserBalances(userId);
  if (balances.savings > 0n) await completeQuest(userId, "first_save");

  const profile = await getProfile(userId);
  if (profile && profile.tier >= 1) await completeQuest(userId, "verify");
}

export async function getGamificationState(userId: string): Promise<{
  quests: Array<(typeof QUEST_DEFS)[number] & { status: string }>;
  streaks: Array<{ streakType: string; currentCount: number; lastTickDate: string | null }>;
  badges: string[];
  lessons: Array<(typeof LESSON_DEFS)[number] & { completed: boolean; score: number | null }>;
  netWorth: { cashMinor: string; savingsMinor: string; totalMinor: string; projectedMonthly: string[] };
}> {
  assertStarter();
  await syncQuestProgress(userId);

  const questRows = await getDb().query<{ quest_id: string; status: string }>(
    "SELECT quest_id, status FROM user_quest_progress WHERE user_id = ?",
    [userId]
  );
  const questMap = new Map(questRows.map((r) => [r.quest_id, r.status]));
  const quests = QUEST_DEFS.map((q) => ({ ...q, status: questMap.get(q.id) ?? "pending" }));

  const streakRows = await getDb().query<{ streak_type: string; current_count: number; last_tick_date: string | null }>(
    "SELECT streak_type, current_count, last_tick_date FROM user_streaks WHERE user_id = ?",
    [userId]
  );
  const streaks = streakRows.map((s) => ({
    streakType: s.streak_type,
    currentCount: s.current_count,
    lastTickDate: s.last_tick_date,
  }));

  const badgeRows = await getDb().query<{ badge_id: string }>("SELECT badge_id FROM user_badges WHERE user_id = ?", [userId]);
  const lessonRows = await getDb().query<{ lesson_id: string; score: number | null }>(
    "SELECT lesson_id, score FROM lesson_completions WHERE user_id = ?",
    [userId]
  );
  const lessonMap = new Map(lessonRows.map((l) => [l.lesson_id, l.score]));
  const lessons = LESSON_DEFS.map((l) => ({
    ...l,
    completed: lessonMap.has(l.id),
    score: lessonMap.get(l.id) ?? null,
  }));

  const balances = await getUserBalances(userId);
  const total = balances.cash + balances.savings;
  const projectedMonthly: string[] = [];
  let acc = total;
  for (let i = 0; i < 6; i++) {
    projectedMonthly.push(acc.toString());
    acc += 1_000n; // educational projection: +$10/mo if habit holds
  }

  return {
    quests,
    streaks,
    badges: badgeRows.map((b) => b.badge_id),
    lessons,
    netWorth: {
      cashMinor: balances.cash.toString(),
      savingsMinor: balances.savings.toString(),
      totalMinor: total.toString(),
      projectedMonthly,
    },
  };
}
