/**
 * Phase 22 — Goeman Starter API. Mounted at /api/starter.
 *
 * 22.0 — households + teen linkage
 * 22.1 — teen debit, spend policies, guardian approvals, freeze
 * 22.2 — savings, goals, interest accrual, guardian match
 * 22.3 — gamification + teen money coach
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import {
  addTeen,
  createHousehold,
  getGuardianDashboard,
  getHouseholdByGuardian,
  listTeens,
  assertGuardianOfTeen,
} from "../services/householdService";
import {
  issueTeenDebitCard,
  updateSpendPolicy,
  getTeenSpendSummary,
  listGuardianReviews,
  resolveGuardianReview,
  guardianFreezeTeen,
  guardianUnfreezeTeen,
} from "../services/teenSpendService";
import {
  createGoal,
  listGoals,
  depositToSavings,
  withdrawFromSavings,
  applyGuardianMatch,
  getSavingsOverview,
  updateSavingsSettings,
} from "../services/savingsGoalService";
import { accrueDaily, listAccruals } from "../services/interestAccrualService";
import { checkIn, completeLesson, getGamificationState } from "../services/gamificationService";
import { getTeenCoachDashboard, listCoachInsightsForGuardian } from "../services/teenCoachService";
import { getProfile } from "../services/identityService";
import {
  openCreditBuilderAccount,
  closeStatement,
  autopayStatement,
  reportStatementToBureau,
  getCreditBuilderAccount,
  listStatements,
} from "../services/creditBuilderService";
import {
  openCustodialAccount,
  proposeCustodialOrder,
  resolveCustodialOrder,
  listCustodialOrders,
  listGuardianCustodialReviews,
  getCustodialAccount,
} from "../services/custodialInvestingService";

export const starterRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "amountMinor must be a positive integer (minor units)");
  }
}

async function requireMinor(userId: string) {
  const profile = await getProfile(userId);
  if (profile?.account_type !== "minor") throw new AppError(ErrorCode.FORBIDDEN, "Teen account required");
  return profile;
}

// --- 22.0 household ---------------------------------------------------------

starterRouter.post("/household", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().optional() }).parse(req.body ?? {});
    res.status(201).json({ household: await createHousehold(req.userId!, body.name) });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/household", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ household: await getHouseholdByGuardian(req.userId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/household/dashboard", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json(await getGuardianDashboard(req.userId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/household/teens", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({ email: z.string().email(), fullName: z.string().min(1), dob: z.string().min(1) })
      .parse(req.body);
    res.status(201).json({
      teen: await addTeen({
        guardianUserId: req.userId!,
        email: body.email,
        fullName: body.fullName,
        dob: body.dob,
      }),
    });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/household/teens", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json({ teens: await listTeens(req.userId!) });
  } catch (e) {
    next(e);
  }
});

// --- 22.1 teen debit + controls -----------------------------------------------

starterRouter.post("/teens/:teenId/card", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.status(201).json({ card: await issueTeenDebitCard(req.userId!, req.params.teenId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.put("/teens/:teenId/spend-policy", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        dailyLimitMinor: z.union([z.string(), z.number()]).optional(),
        weeklyLimitMinor: z.union([z.string(), z.number()]).optional(),
        monthlyLimitMinor: z.union([z.string(), z.number()]).optional(),
        categoryLimits: z.record(z.string()).optional(),
        blockedMerchants: z.array(z.string()).optional(),
      })
      .parse(req.body);
    res.json({
      policy: await updateSpendPolicy(req.userId!, req.params.teenId!, {
        dailyLimitMinor: body.dailyLimitMinor !== undefined ? amount(body.dailyLimitMinor) : undefined,
        weeklyLimitMinor: body.weeklyLimitMinor !== undefined ? amount(body.weeklyLimitMinor) : undefined,
        monthlyLimitMinor: body.monthlyLimitMinor !== undefined ? amount(body.monthlyLimitMinor) : undefined,
        categoryLimits: body.categoryLimits,
        blockedMerchants: body.blockedMerchants,
      }),
    });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/teens/:teenId/spend", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const profile = await getProfile(req.params.teenId!);
    if (profile?.account_type === "minor" && profile.guardian_user_id !== req.userId! && req.userId !== req.params.teenId) {
      throw new AppError(ErrorCode.FORBIDDEN, "Not authorized");
    }
    if (req.userId !== req.params.teenId) await assertGuardianOfTeen(req.userId!, req.params.teenId!);
    res.json(await getTeenSpendSummary(req.params.teenId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/reviews", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json({ reviews: await listGuardianReviews(req.userId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/reviews/:id/decide", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().optional() }).parse(req.body);
    res.json(await resolveGuardianReview(req.userId!, req.params.id!, body.decision, body.reason));
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/teens/:teenId/freeze", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    await guardianFreezeTeen(req.userId!, req.params.teenId!, body.reason ?? "guardian_freeze");
    res.json({ frozen: true });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/teens/:teenId/unfreeze", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    await guardianUnfreezeTeen(req.userId!, req.params.teenId!, body.reason ?? "guardian_unfreeze");
    res.json({ frozen: false });
  } catch (e) {
    next(e);
  }
});

// --- 22.2 savings -------------------------------------------------------------

starterRouter.get("/savings", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getSavingsOverview(req.userId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/savings/goals", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string(), targetMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    res.status(201).json({ goal: await createGoal(req.userId!, body.name, amount(body.targetMinor)) });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/savings/goals", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ goals: await listGoals(req.userId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/savings/deposit", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({ amountMinor: z.union([z.string(), z.number()]), goalId: z.string().optional() })
      .parse(req.body);
    const key = req.header("Idempotency-Key")!;
    const amt = amount(body.amountMinor);
    const result = await depositToSavings(req.userId!, amt, body.goalId, key);
    const profile = await getProfile(req.userId!);
    let match = null;
    if (profile?.guardian_user_id) {
      match = await applyGuardianMatch(profile.guardian_user_id, req.userId!, amt, key);
    }
    res.status(201).json({ ...result, match });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/savings/withdraw", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    res.json(await withdrawFromSavings(req.userId!, amount(body.amountMinor), req.header("Idempotency-Key")!));
  } catch (e) {
    next(e);
  }
});

starterRouter.put("/teens/:teenId/savings-settings", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        apyBps: z.number().optional(),
        guardianMatchBps: z.number().optional(),
        savingsLocked: z.boolean().optional(),
        roundUpGoalId: z.string().nullable().optional(),
      })
      .parse(req.body);
    res.json({ settings: await updateSavingsSettings(req.userId!, req.params.teenId!, body) });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/savings/accruals", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ accruals: await listAccruals(req.userId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/admin/interest/accrue", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ teenId: z.string(), period: z.string().optional() }).parse(req.body);
    await assertGuardianOfTeen(req.userId!, body.teenId);
    const { getOrCreateSavingsSettings } = await import("../services/savingsGoalService");
    const settings = await getOrCreateSavingsSettings(body.teenId, req.userId!);
    const period = body.period ?? new Date().toISOString().slice(0, 10);
    res.json({ accrual: await accrueDaily(body.teenId, period, settings.apy_bps) });
  } catch (e) {
    next(e);
  }
});

// --- 22.3 gamification + coach -----------------------------------------------

starterRouter.get("/gamification", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getGamificationState(req.userId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/gamification/check-in", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await requireMinor(req.userId!);
    res.json(await checkIn(req.userId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/gamification/lessons/:lessonId/complete", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await requireMinor(req.userId!);
    const body = z.object({ score: z.number().min(0).max(100).default(100) }).parse(req.body ?? {});
    await completeLesson(req.userId!, req.params.lessonId!, body.score);
    res.json({ completed: true });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/coach", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await requireMinor(req.userId!);
    res.json(await getTeenCoachDashboard(req.userId!));
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/coach/insights", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const teenId = typeof req.query.teenId === "string" ? req.query.teenId : undefined;
    res.json({ insights: await listCoachInsightsForGuardian(req.userId!, teenId) });
  } catch (e) {
    next(e);
  }
});

// --- 22.4 credit-builder ------------------------------------------------------

starterRouter.post("/teens/:teenId/credit-builder", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ securedLimitMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    res.status(201).json({
      account: await openCreditBuilderAccount({
        guardianUserId: req.userId!,
        teenUserId: req.params.teenId!,
        securedLimitMinor: amount(body.securedLimitMinor),
      }),
    });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/teens/:teenId/credit-builder", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ account: await getCreditBuilderAccount(req.params.teenId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/credit-builder/:accountId/close-statement", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ period: z.string() }).parse(req.body);
    res.json({ statement: await closeStatement(req.params.accountId!, body.period) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/credit-builder/statements/:id/autopay", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res, next) => {
  try {
    res.json({ statement: await autopayStatement(req.userId!, req.params.id!, req.header("Idempotency-Key")!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/credit-builder/statements/:id/report", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json(await reportStatementToBureau(req.userId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/credit-builder/:accountId/statements", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json({ statements: await listStatements(req.params.accountId!) });
  } catch (e) {
    next(e);
  }
});

// --- 22.5 custodial investing -------------------------------------------------

starterRouter.post("/teens/:teenId/custodial", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ accountType: z.enum(["ugma", "utma"]).optional() }).parse(req.body ?? {});
    res.status(201).json({
      account: await openCustodialAccount({
        guardianUserId: req.userId!,
        teenUserId: req.params.teenId!,
        accountType: body.accountType,
      }),
    });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/teens/:teenId/custodial", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ account: await getCustodialAccount(req.params.teenId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/custodial/orders", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    await requireMinor(req.userId!);
    const body = z
      .object({
        assetId: z.string(),
        side: z.enum(["buy", "sell"]),
        qtyBase: z.union([z.string(), z.number()]),
      })
      .parse(req.body);
    res.status(201).json({
      order: await proposeCustodialOrder({
        teenUserId: req.userId!,
        assetId: body.assetId,
        side: body.side,
        qtyBase: amount(body.qtyBase),
        idempotencyKey: req.header("Idempotency-Key")!,
      }),
    });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/custodial/orders", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const teenId = typeof req.query.teenId === "string" ? req.query.teenId : req.userId!;
    res.json({ orders: await listCustodialOrders(teenId) });
  } catch (e) {
    next(e);
  }
});

starterRouter.get("/custodial/reviews", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.json({ reviews: await listGuardianCustodialReviews(req.userId!) });
  } catch (e) {
    next(e);
  }
});

starterRouter.post("/custodial/reviews/:id/decide", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().optional() }).parse(req.body);
    res.json(await resolveCustodialOrder(req.userId!, req.params.id!, body.decision, body.reason));
  } catch (e) {
    next(e);
  }
});
