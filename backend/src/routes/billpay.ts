/**
 * Phase 19.3 — bill pay API (customer surface). Mounted at /api/billpay.
 *
 *   GET  /api/billpay/payees                  — your saved billers
 *   POST /api/billpay/payees                  { name, category?, last4? }
 *   GET  /api/billpay/payments                — your payments
 *   POST /api/billpay/pay                      { payeeId, amountMinor, recurrence?, scheduledFor? } (Idempotency-Key)
 *   POST /api/billpay/payments/:id/cancel      — cancel a not-yet-sent payment
 *
 * Scheduled payments are settled by the admin/ops due-loop (/api/admin/billpay/process).
 * All gated by BILLPAY_ENABLED via the service. Requires Tier 2 for money-moving routes.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { addPayee, listPayees, payBill, cancelBill, listPayments } from "../services/billPayService";

export const billpayRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "amountMinor must be a positive integer (minor units)");
  }
}

billpayRouter.get("/payees", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ payees: await listPayees(req.userId!) });
  } catch (e) {
    next(e);
  }
});

billpayRouter.post("/payees", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string(), category: z.string().optional(), last4: z.string().optional() }).parse(req.body);
    res.status(201).json(await addPayee({ userId: req.userId!, name: body.name, category: body.category, last4: body.last4 }));
  } catch (e) {
    next(e);
  }
});

billpayRouter.get("/payments", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ payments: await listPayments(req.userId!) });
  } catch (e) {
    next(e);
  }
});

billpayRouter.post("/pay", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        payeeId: z.string(),
        amountMinor: z.union([z.string(), z.number()]),
        recurrence: z.enum(["none", "weekly", "monthly"]).optional(),
        scheduledFor: z.string().optional(),
      })
      .parse(req.body);
    const result = await payBill({
      userId: req.userId!,
      payeeId: body.payeeId,
      amountMinor: amount(body.amountMinor),
      recurrence: body.recurrence,
      scheduledFor: body.scheduledFor,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

billpayRouter.post("/payments/:id/cancel", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await cancelBill(req.userId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});
