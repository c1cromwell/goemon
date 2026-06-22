/**
 * Phase 5 — Hedera routes.
 *
 * GET  /api/hedera/account           — fetch user's Hedera account info (404 if none)
 * POST /api/hedera/account           — create Hedera account (paymaster funds it; optional device publicKey)
 * GET  /api/hedera/balance           — on-chain HBAR + USDC and ledger USDC balance
 * POST /api/hedera/transfer          — USDC transfer on-chain + ledger journal (server-signed; idempotent)
 * POST /api/hedera/transfer/build    — frozen tx bytes for on-device signing (non-custodial)
 * POST /api/hedera/transfer/submit   — submit wallet-signed bytes + post ledger journal
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
  buildUsdcTransfer,
  submitUsdcTransfer,
  isHederaEnabled,
} from "../services/hederaService";
import { getUserById } from "../services/authService";
import { getUserBalances } from "../services/ledgerService";
import { hederaAccountToEvmAddress } from "../utils/hip583";
import { initiateCctpTransfer, listCctpTransfers } from "../services/cctpService";
import { registerDeviceToken } from "../services/notificationService";
import { pollInboundForUser } from "../services/mirrorSubscriptionService";

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
      evmAddress: account.evm_address ?? hederaAccountToEvmAddress(account.hedera_account_id),
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
    const body = z.object({ publicKey: z.string().min(1).optional() }).parse(req.body ?? {});
    const account = await getOrCreateUserHederaAccount(req.userId!, { publicKeyDer: body.publicKey });
    res.status(201).json({
      hederaAccountId: account.hedera_account_id,
      evmAddress: account.evm_address ?? (account.hedera_account_id ? hederaAccountToEvmAddress(account.hedera_account_id) : null),
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

const buildTransferSchema = transferSchema;

hederaRouter.post(
  "/transfer/build",
  requireAuth,
  idempotency(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      assertHederaEnabled();
      const body = buildTransferSchema.parse(req.body);
      const amountMicro = BigInt(body.amountMicro);
      if (amountMicro <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMicro must be positive");

      const build = await buildUsdcTransfer({
        fromUserId: req.userId!,
        toUserId: body.toUserId,
        toHederaAccountId: body.toHederaAccountId,
        amountMicro,
        idempotencyKey: req.header("Idempotency-Key")!,
      });

      res.status(201).json(build);
    } catch (e) {
      next(e);
    }
  }
);

const submitTransferSchema = z.object({
  buildId: z.string().min(1),
  signedTransactionBytesBase64: z.string().min(1).optional(),
  signatureHex: z.string().regex(/^[0-9a-fA-F]+$/).optional(),
}).refine((b) => !!(b.signedTransactionBytesBase64 || b.signatureHex), {
  message: "Provide signedTransactionBytesBase64 or signatureHex",
});

hederaRouter.post(
  "/transfer/submit",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      assertHederaEnabled();
      const body = submitTransferSchema.parse(req.body);
      const result = await submitUsdcTransfer({
        fromUserId: req.userId!,
        buildId: body.buildId,
        signedTransactionBytesBase64: body.signedTransactionBytesBase64,
        signatureHex: body.signatureHex,
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

hederaRouter.post("/cctp", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      direction: z.enum(["in", "out"]),
      sourceChain: z.enum(["ethereum", "base", "polygon", "hedera"]),
      destChain: z.enum(["ethereum", "base", "polygon", "hedera"]).optional(),
      amountMicro: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
    }).parse(req.body);
    const result = await initiateCctpTransfer({
      userId: req.userId!,
      direction: body.direction,
      sourceChain: body.sourceChain,
      destChain: body.destChain,
      amountMicro: BigInt(body.amountMicro),
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

hederaRouter.get("/cctp", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await listCctpTransfers(req.userId!);
    res.json({ transfers: rows });
  } catch (e) {
    next(e);
  }
});

hederaRouter.post("/devices", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      platform: z.enum(["ios", "android", "web"]),
      token: z.string().min(1),
    }).parse(req.body);
    await registerDeviceToken({ userId: req.userId!, platform: body.platform, token: body.token });
    res.status(201).json({ registered: true });
  } catch (e) {
    next(e);
  }
});

hederaRouter.post("/poll-inbound", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertHederaEnabled();
    const count = await pollInboundForUser(req.userId!);
    res.json({ newEvents: count });
  } catch (e) {
    next(e);
  }
});
