/**
 * X-Money response F6 — cross-border send (remittance) routes on the native rail.
 *
 * POST /api/cross-border/quote  — preview a corridor (recipient receives X); no money
 * POST /api/cross-border/send   — send to a recipient in another currency (auth + idempotent)
 * GET  /api/cross-border/sends  — your cross-border history
 *
 * Send moves money → Idempotency-Key. Gated by FX_SETTLEMENT_ENABLED inside the service.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { resolveUserRef } from "../services/authService";
import { quoteCorridor, send, listSends } from "../services/crossBorderService";

export const crossBorderRouter = Router();

const amount = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

crossBorderRouter.post("/quote", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ from: z.string().min(1), to: z.string().min(1), amountMinor: amount }).parse(req.body);
    res.json(await quoteCorridor({ from: body.from, to: body.to, amountMinor: BigInt(body.amountMinor) }));
  } catch (e) {
    next(e);
  }
});

crossBorderRouter.post("/send", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // `recipient` may be an email or a user id (resolved server-side).
    const body = z.object({ recipient: z.string().min(1), from: z.string().min(1), to: z.string().min(1), fromAmountMinor: amount }).parse(req.body);
    const recipientUserId = await resolveUserRef(body.recipient);
    res.json(await send({ senderUserId: req.userId!, recipientUserId, from: body.from, to: body.to, fromAmountMinor: BigInt(body.fromAmountMinor), idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});

crossBorderRouter.get("/sends", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ sends: await listSends(req.userId!) });
  } catch (e) {
    next(e);
  }
});
