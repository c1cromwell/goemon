/**
 * Phase 4 — Accounts routes.
 *
 * GET  /api/accounts/balance      — ledger-derived balance
 * POST /api/accounts/transfer     — user-to-user transfer (idempotent)
 * GET  /api/accounts/transactions — recent transaction history
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { getUserBalances } from "../services/ledgerService";
import { transfer, getTransactionHistory } from "../services/transferService";

export const accountsRouter = Router();

accountsRouter.get("/balance", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { cash, savings } = await getUserBalances(req.userId!);
    res.json({
      cash: { amount: cash.toString(), currency: "USD" },
      savings: { amount: savings.toString(), currency: "USD" },
    });
  } catch (e) {
    next(e);
  }
});

accountsRouter.post("/transfer", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { toUserId, amountMinor, currency = "USD", description } = req.body as {
      toUserId?: string;
      amountMinor?: number | string;
      currency?: string;
      description?: string;
    };

    if (!toUserId) throw new AppError(ErrorCode.VALIDATION, "toUserId required");
    if (amountMinor === undefined || amountMinor === null) throw new AppError(ErrorCode.VALIDATION, "amountMinor required");

    const amount = BigInt(amountMinor);
    if (amount <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");
    if (req.userId === toUserId) throw new AppError(ErrorCode.VALIDATION, "Cannot transfer to yourself");

    const idempotencyKey = req.header("Idempotency-Key")!;
    const result = await transfer({
      fromUserId: req.userId!,
      toUserId,
      amountMinor: amount,
      currency,
      description,
      idempotencyKey,
    });

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

accountsRouter.get("/transactions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const history = await getTransactionHistory(req.userId!, limit);
    res.json(history);
  } catch (e) {
    next(e);
  }
});
