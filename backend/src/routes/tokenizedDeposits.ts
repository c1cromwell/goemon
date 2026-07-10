/**
 * Tokenized-deposit readiness seam (customer + admin surfaces).
 * See docs/business/SWIFT-SHARED-LEDGER-ASSESSMENT.md. Gated by TOKENIZED_DEPOSITS_ENABLED.
 *
 *   POST /api/tokenized-deposits/issue    { amountMinor }   (Idempotency-Key)  — mirror a bank mint
 *   POST /api/tokenized-deposits/redeem   { amountMinor }   (Idempotency-Key)  — redeem to the bank
 *   GET  /api/tokenized-deposits/position                                       — balance + yield rate
 *   POST /api/admin/tokenized-deposits/accrue  { userId, periodDays }  (RBAC)   — accrue yield
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { AppError, ErrorCode } from "../errors";
import { issue, redeem, getPosition, accrueInterest } from "../services/tokenizedDepositService";

function big(v: string | number, field: string): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, `${field} must be a positive integer (minor units)`);
  }
}

export const tokenizedDepositsRouter = Router();

tokenizedDepositsRouter.post("/issue", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    res.status(201).json(await issue({ userId: req.userId!, amountMinor: big(body.amountMinor, "amountMinor"), idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});

tokenizedDepositsRouter.post("/redeem", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    res.json(await redeem({ userId: req.userId!, amountMinor: big(body.amountMinor, "amountMinor"), idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});

tokenizedDepositsRouter.get("/position", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getPosition(req.userId!));
  } catch (e) {
    next(e);
  }
});

export const tokenizedDepositsAdminRouter = Router();

tokenizedDepositsAdminRouter.post(
  "/tokenized-deposits/accrue",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ userId: z.string(), periodDays: z.number().positive() }).parse(req.body ?? {});
      res.json(await accrueInterest({ userId: body.userId, periodDays: body.periodDays }));
    } catch (e) {
      next(e);
    }
  }
);
