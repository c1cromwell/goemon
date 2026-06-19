/**
 * Phase 22.1–22.3 — teen debit controls, savings, gamification, coach.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-starter-stages-${Date.now()}.db`;
let seq = 0;
function uniqEmail(prefix: string): string {
  return `${prefix}-${seq++}-${uuidv4()}@test.com`;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { TEEN_ENABLED: boolean }).TEEN_ENABLED = true;
  (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TMP_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

async function tier2Guardian() {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const user = await createUser(uniqEmail("guardian"), "Guardian Parent");
  await getDb().execute("UPDATE identity_profiles SET tier = 2, identity_status = 'kyc_passed' WHERE user_id = ?", [user.id]);
  return user;
}

async function setupHouseholdWithTeen() {
  const { createHousehold, addTeen } = await import("../src/services/householdService");
  const guardian = await tier2Guardian();
  await createHousehold(guardian.id);
  const teen = await addTeen({
    guardianUserId: guardian.id,
    email: uniqEmail("teen"),
    fullName: "Alex Teen",
    dob: "2010-06-15",
  });
  return { guardian, teen };
}

describe("22.1 teen debit + spend gate", () => {
  it("issues teen card, blocks over daily limit, guardian approves override", async () => {
    const { issueTeenDebitCard, updateSpendPolicy, resolveGuardianReview, listGuardianReviews } = await import(
      "../src/services/teenSpendService"
    );
    const { authorize } = await import("../src/services/cardService");
    const { getOrCreateUserAccount, postJournal } = await import("../src/services/ledgerService");
    const { guardian, teen } = await setupHouseholdWithTeen();

    await updateSpendPolicy(guardian.id, teen.userId, { dailyLimitMinor: 2_000n });
    const card = await issueTeenDebitCard(guardian.id, teen.userId);

    const guardianCash = await getOrCreateUserAccount(guardian.id, "user_cash", "USD");
    const teenCash = await getOrCreateUserAccount(teen.userId, "user_cash", "USD");
    await postJournal(
      [
        { ledgerAccountId: guardianCash, direction: "debit", amountMinor: 10_000n, currency: "USD" },
        { ledgerAccountId: teenCash, direction: "credit", amountMinor: 10_000n, currency: "USD" },
      ],
      "Fund teen",
      { idempotencyKey: `fund-${uuidv4()}` }
    );

    const key = `teen-auth-${uuidv4()}`;
    await expect(
      authorize({
        userId: teen.userId,
        cardId: card.id,
        amountMinor: 5_000n,
        merchant: "GameStop",
        idempotencyKey: key,
      })
    ).rejects.toMatchObject({ code: ErrorCode.GUARDIAN_APPROVAL_REQUIRED });

    const reviews = await listGuardianReviews(guardian.id);
    expect(reviews.length).toBeGreaterThanOrEqual(1);

    const result = await resolveGuardianReview(guardian.id, reviews[0]!.id, "approve");
    expect(result.status).toBe("approved");
    expect(result.cardAuth?.status).toBe("authorized");
  });

  it("guardian freeze blocks card auth", async () => {
    const { issueTeenDebitCard, guardianFreezeTeen } = await import("../src/services/teenSpendService");
    const { authorize } = await import("../src/services/cardService");
    const { getOrCreateUserAccount, postJournal } = await import("../src/services/ledgerService");
    const { guardian, teen } = await setupHouseholdWithTeen();
    const card = await issueTeenDebitCard(guardian.id, teen.userId);
    const guardianCash = await getOrCreateUserAccount(guardian.id, "user_cash", "USD");
    const teenCash = await getOrCreateUserAccount(teen.userId, "user_cash", "USD");
    await postJournal(
      [
        { ledgerAccountId: guardianCash, direction: "debit", amountMinor: 5_000n, currency: "USD" },
        { ledgerAccountId: teenCash, direction: "credit", amountMinor: 5_000n, currency: "USD" },
      ],
      "Fund teen",
      { idempotencyKey: `fund2-${uuidv4()}` }
    );
    await guardianFreezeTeen(guardian.id, teen.userId, "test freeze");
    await expect(
      authorize({ userId: teen.userId, cardId: card.id, amountMinor: 100n, idempotencyKey: `f-${uuidv4()}` })
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("22.2 savings + interest", () => {
  it("deposits to savings with guardian match and accrues interest idempotently", async () => {
    const { depositToSavings, applyGuardianMatch, getOrCreateSavingsSettings } = await import("../src/services/savingsGoalService");
    const { accrueDaily } = await import("../src/services/interestAccrualService");
    const { getOrCreateUserAccount, postJournal, getUserBalances } = await import("../src/services/ledgerService");
    const { guardian, teen } = await setupHouseholdWithTeen();

    const guardianCash = await getOrCreateUserAccount(guardian.id, "user_cash", "USD");
    const teenCash = await getOrCreateUserAccount(teen.userId, "user_cash", "USD");
    await postJournal(
      [
        { ledgerAccountId: guardianCash, direction: "debit", amountMinor: 100_000n, currency: "USD" },
        { ledgerAccountId: teenCash, direction: "credit", amountMinor: 100_000n, currency: "USD" },
      ],
      "Allowance",
      { idempotencyKey: `allow-${uuidv4()}` }
    );

    const key = `save-${uuidv4()}`;
    await depositToSavings(teen.userId, 50_000n, undefined, key);
    const match = await applyGuardianMatch(guardian.id, teen.userId, 50_000n, key);
    expect(match?.matchMinor).toBe(25_000n);

    const balances = await getUserBalances(teen.userId);
    expect(balances.savings).toBe(75_000n);

    const settings = await getOrCreateSavingsSettings(teen.userId, guardian.id);
    const period = "2026-06-01";
    const a1 = await accrueDaily(teen.userId, period, settings.apy_bps);
    const a2 = await accrueDaily(teen.userId, period, settings.apy_bps);
    expect(a1?.id).toBe(a2?.id);
    expect(a1).not.toBeNull();
    expect(BigInt(a1!.accrued_minor)).toBeGreaterThan(0n);
  });
});

describe("22.3 gamification + coach", () => {
  it("check-in streak, lesson completion, and coach insights", async () => {
    const { checkIn, completeLesson, getGamificationState } = await import("../src/services/gamificationService");
    const { analyzeSpending, listCoachInsightsForGuardian } = await import("../src/services/teenCoachService");
    const { guardian, teen } = await setupHouseholdWithTeen();

    const s1 = await checkIn(teen.userId);
    expect(s1.currentCount).toBe(1);
    const s2 = await checkIn(teen.userId);
    expect(s2.currentCount).toBe(1); // same day

    await completeLesson(teen.userId, "compound_interest", 100);
    const state = await getGamificationState(teen.userId);
    expect(state.lessons.find((l) => l.id === "compound_interest")?.completed).toBe(true);
    expect(state.quests.find((q) => q.id === "first_lesson")?.status).toBe("completed");

    await analyzeSpending(teen.userId);
    const insights = await listCoachInsightsForGuardian(guardian.id, teen.userId);
    expect(insights.length).toBeGreaterThanOrEqual(1);
  });
});
