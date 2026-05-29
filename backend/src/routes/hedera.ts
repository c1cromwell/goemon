/**
 * Phase 5 — Hedera routes.
 *
 * GET  /api/hedera/account    — fetch user's Hedera account info (404 if none)
 * POST /api/hedera/account    — create Hedera account (paymaster funds it)
 * GET  /api/hedera/balance    — on-chain HBAR + USDC and ledger USDC balance
 * POST /api/hedera/transfer   — USDC transfer on-chain + ledger journal (idempotent)
 *
 * All routes require authentication. All routes require HEDERA_ENABLED=true.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import {
  getUserHederaAccount,
  getOrCreateUserHederaAccount,
  getOnChainBalances,
  transferUsdcOnChain,
  isHederaEnabled,
} from "../services/hederaService";
import { getUserById } from "../services/authService";
import { getUserBalances } from "../services/ledgerService";

export const hederaRouter = Router();

function assertHederaEnabled(): void {
  if (!isHederaEnabled()) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Hedera integration is not enabled on this server");
  }
}

hederaRouter.get("/account", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertHederaEnabled();
    const account = await getUserHederaAccount(req.userId!);
    if (!account?.hedera_account_id) {
      throw new AppError(ErrorCode.NOT_FOUND, "No Hedera account — call POST /api/hedera/account to create one");
    }
    res.json({
      hederaAccountId: account.hedera_account_id,
      publicKey: account.public_key,
      network: account.network,
      usdcAssociated: account.usdc_associated === 1,
    });
  } catch (e) {
    next(e);
  }
});

hederaRouter.post("/account", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertHederaEnabled();
    const account = await getOrCreateUserHederaAccount(req.userId!);
    res.status(201).json({
      hederaAccountId: account.hedera_account_id,
      network: account.network,
      usdcAssociated: account.usdc_associated === 1,
    });
  } catch (e) {
    next(e);
  }
});

hederaRouter.get("/balance", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertHederaEnabled();
    const account = await getUserHederaAccount(req.userId!);
    if (!account?.hedera_account_id) {
      throw new AppError(ErrorCode.NOT_FOUND, "No Hedera account — call POST /api/hedera/account first");
    }

    const [onChain, ledgerUsdc] = await Promise.all([
      getOnChainBalances(account.hedera_account_id),
      getUserBalances(req.userId!, "USDC"),
    ]);

    res.json({
      onChain: {
        hbarTinybars: onChain.hbarTinybars.toString(),
        usdcMicro: onChain.usdcMicro.toString(),
      },
      ledger: {
        usdcCash: ledgerUsdc.cash.toString(),
      },
    });
  } catch (e) {
    next(e);
  }
});

const transferSchema = z.object({
  toUserId: z.string().optional(),
  toHederaAccountId: z.string().optional(),
  amountMicro: z.union([
    z.string().regex(/^\d+$/, "amountMicro must be a non-negative integer string"),
    z.number().int().positive(),
  ]),
  description: z.string().max(500).optional(),
});

hederaRouter.post(
  "/transfer",
  requireAuth,
  idempotency(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      assertHederaEnabled();
      const body = transferSchema.parse(req.body);
      const amountMicro = BigInt(body.amountMicro);

      if (amountMicro <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMicro must be positive");
      if (!body.toUserId && !body.toHederaAccountId) {
        throw new AppError(ErrorCode.VALIDATION, "Provide either toUserId or toHederaAccountId");
      }
      if (body.toUserId && body.toHederaAccountId) {
        throw new AppError(ErrorCode.VALIDATION, "Provide toUserId or toHederaAccountId, not both");
      }

      let toHederaAccountId = body.toHederaAccountId;
      let toUserId = body.toUserId;

      if (toUserId) {
        const toUser = await getUserById(toUserId);
        if (!toUser) throw new AppError(ErrorCode.NOT_FOUND, "Recipient user not found");
        const recipientAccount = await getUserHederaAccount(toUserId);
        if (!recipientAccount?.hedera_account_id) {
          throw new AppError(ErrorCode.NOT_FOUND, "Recipient has no Hedera account");
        }
        toHederaAccountId = recipientAccount.hedera_account_id;
      }

      const idempotencyKey = req.header("Idempotency-Key")!;
      const result = await transferUsdcOnChain({
        fromUserId: req.userId!,
        toHederaAccountId: toHederaAccountId!,
        toUserId,
        amountMicro,
        idempotencyKey,
      });

      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);
