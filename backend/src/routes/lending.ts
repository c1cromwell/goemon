/**
 * Collateralized lending API (customer surface). Mounted at /api/lending.
 *
 *   POST /api/lending/quote   { collateralAssetId, collateralQtyBase }     → borrowing power
 *   POST /api/lending/loans   { collateralAssetId, collateralQtyBase, borrowMinor }  (Idempotency-Key)
 *   GET  /api/lending/loans
 *   GET  /api/lending/loans/:id
 *   POST /api/lending/loans/:id/repay   { amountMinor }                    (Idempotency-Key)
 *
 * Money-moving routes require an Idempotency-Key. Gated by LENDING_ENABLED via the service
 * (LENDING_DISABLED when off). Accrual + liquidation are admin/ops surfaces (lendingAdmin).
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { openLoan, repay, getLoan, listLoans, borrowingPower } from "../services/lendingService";

export const lendingRouter = Router();

function big(v: string | number, field: string): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, `${field} must be a positive integer (minor/base units)`);
  }
}

lendingRouter.post("/quote", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ collateralAssetId: z.string(), collateralQtyBase: z.union([z.string(), z.number()]), borrowCurrency: z.string().optional() }).parse(req.body);
    res.json(await borrowingPower(body.collateralAssetId, big(body.collateralQtyBase, "collateralQtyBase"), body.borrowCurrency));
  } catch (e) {
    next(e);
  }
});

lendingRouter.post("/loans", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        collateralAssetId: z.string(),
        collateralQtyBase: z.union([z.string(), z.number()]),
        borrowMinor: z.union([z.string(), z.number()]),
        borrowCurrency: z.string().optional(),
      })
      .parse(req.body);
    const loan = await openLoan({
      userId: req.userId!,
      collateralAssetId: body.collateralAssetId,
      collateralQtyBase: big(body.collateralQtyBase, "collateralQtyBase"),
      borrowMinor: big(body.borrowMinor, "borrowMinor"),
      borrowCurrency: body.borrowCurrency,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(loan);
  } catch (e) {
    next(e);
  }
});

lendingRouter.get("/loans", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await listLoans(req.userId!));
  } catch (e) {
    next(e);
  }
});

lendingRouter.get("/loans/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getLoan(req.userId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});

lendingRouter.post("/loans/:id/repay", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]) }).parse(req.body);
    const loan = await repay({
      userId: req.userId!,
      loanId: req.params.id!,
      amountMinor: big(body.amountMinor, "amountMinor"),
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.json(loan);
  } catch (e) {
    next(e);
  }
});
