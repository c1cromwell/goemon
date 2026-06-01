/**
 * Phase 6 — SmartChat routes.
 *
 * All routes sit behind requireAuth + requireTier(2) (mounted in index.ts).
 *
 *   POST   /api/smartchat            — send a message; classify → issue → (execute | await MFA)
 *   POST   /api/smartchat/tokens/:id/mfa — submit an MFA code to confirm + execute a transfer
 *   GET    /api/smartchat/tokens     — list the user's operation tokens
 *   GET    /api/smartchat/tokens/:id — fetch one operation token
 *
 * The MFA confirmation endpoint moves money, so it carries the idempotency()
 * middleware; the underlying execute is also idempotent via the operation-token id.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, getClientIp, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import * as smartchat from "../services/smartchatService";

export const smartchatRouter = Router();

smartchatRouter.post("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body as { message?: string };
    if (typeof message !== "string" || message.trim() === "") {
      throw new AppError(ErrorCode.VALIDATION, "message is required");
    }
    const result = await smartchat.handleMessage({
      userId: req.userId!,
      message,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

smartchatRouter.post(
  "/tokens/:id/mfa",
  requireAuth,
  idempotency(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body as { code?: string };
      if (typeof code !== "string" || code.trim() === "") {
        throw new AppError(ErrorCode.VALIDATION, "code is required");
      }
      const result = await smartchat.verifyMfaAndExecute({
        userId: req.userId!,
        tokenId: req.params.id!,
        code,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

smartchatRouter.get("/tokens", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const tokens = await smartchat.listOperationTokens(req.userId!, limit);
    res.json(tokens);
  } catch (e) {
    next(e);
  }
});

smartchatRouter.get("/tokens/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = await smartchat.getOperationToken(req.userId!, req.params.id!);
    res.json(token);
  } catch (e) {
    next(e);
  }
});
