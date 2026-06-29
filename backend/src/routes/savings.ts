/**
 * Phase 24.9 — Borderless savings routes.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import {
  accrueBorderlessDaily,
  depositToSavings,
  enrollBorderlessSavings,
  getBorderlessSummary,
  withdrawFromSavings,
} from "../services/savingsProductService";

export const savingsRouter = Router();

savingsRouter.use(requireAuth);

savingsRouter.get("/borderless", async (req: AuthRequest, res, next) => {
  try {
    res.json(await getBorderlessSummary(req.userId!));
  } catch (e) {
    next(e);
  }
});

savingsRouter.post("/borderless/enroll", async (req: AuthRequest, res, next) => {
  try {
    res.status(201).json(await enrollBorderlessSavings(req.userId!));
  } catch (e) {
    next(e);
  }
});

savingsRouter.post("/borderless/deposit", idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const { amountMinor } = z.object({ amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]) }).parse(req.body);
    res.json(await depositToSavings(req.userId!, BigInt(amountMinor), req.header("Idempotency-Key")!));
  } catch (e) {
    next(e);
  }
});

savingsRouter.post("/borderless/withdraw", idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const { amountMinor } = z.object({ amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]) }).parse(req.body);
    res.json(await withdrawFromSavings(req.userId!, BigInt(amountMinor), req.header("Idempotency-Key")!));
  } catch (e) {
    next(e);
  }
});

/** Idempotent daily accrual hook (admin cron or dev). */
savingsRouter.post("/borderless/accrue", async (req: AuthRequest, res, next) => {
  try {
    const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.body?.period ?? new Date().toISOString().slice(0, 10));
    res.json((await accrueBorderlessDaily(req.userId!, period)) ?? { accruedMinor: "0" });
  } catch (e) {
    next(e);
  }
});
