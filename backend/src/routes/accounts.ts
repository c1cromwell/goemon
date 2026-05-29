/**
 * Phase 4 — Accounts routes.
 *
 * GET  /api/accounts/balance      — ledger-derived balance
 * POST /api/accounts/transfer     — user-to-user transfer (idempotent)
 * GET  /api/accounts/transactions — recent transaction history
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { getUserBalances } from "../services/ledgerService";
import { transfer, getTransactionHistory } from "../services/transferService";

const MAX_TRANSFER_MINOR = 10_000_000n; // $100,000 per transaction ceiling

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

const transferBodySchema = z.object({
  toUserId: z.string().min(1),
  amountMinor: z.union([
    z.string().regex(/^\d+$/, "amountMinor must be a positive integer string"),
    z.number().int().positive(),
  ]),
  currency: z.enum(["USD", "USDC"]).default("USD"),
  description: z.string().max(500).optional(),
});

accountsRouter.post("/transfer", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = transferBodySchema.parse(req.body);
    const amount = BigInt(body.amountMinor);

    if (amount <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");
    if (amount > MAX_TRANSFER_MINOR) {
      throw new AppError(ErrorCode.VALIDATION, `Transfer exceeds maximum of ${MAX_TRANSFER_MINOR} minor units`);
    }
    if (req.userId === body.toUserId) throw new AppError(ErrorCode.VALIDATION, "Cannot transfer to yourself");

    const { toUserId, currency, description } = body;

    const idempotencyKey = req.header("Idempotency-Key")!;
    const result = await transfer({
      fromUserId: req.userId!,
      toUserId: toUserId,
      amountMinor: amount,
      currency: currency,
      description: description,
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
