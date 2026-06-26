/**
 * X-Money response F3 — P2P money requests (request-to-pay) on Argus's own rail.
 *
 * POST /api/requests              — create a request ($X from a user, or an open link)
 * GET  /api/requests?role=sent|received — your requests
 * GET  /api/requests/:id          — one request
 * POST /api/requests/:id/fulfill  — pay it (settles on the native rail; idempotent)
 * POST /api/requests/:id/decline  — the asked payer declines
 * POST /api/requests/:id/cancel   — the requester cancels
 *
 * Non-custodial, no Visa/partner: fulfill rides executeTransfer (the ledger / USDC).
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { currencySchema } from "../services/currencyRegistry";
import { resolveUserRef } from "../services/authService";
import { createRequest, listRequests, getRequest, fulfillRequest, declineRequest, cancelRequest } from "../services/paymentRequestService";

export const paymentRequestsRouter = Router();

const amount = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

paymentRequestsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      // `from` may be an email or a user id (resolved server-side); blank = open request.
      from: z.string().optional(),
      amountMinor: amount,
      currency: currencySchema(),
      memo: z.string().max(280).optional(),
      ttlSecs: z.number().int().positive().optional(),
    }).parse(req.body);
    const fromUserId = body.from?.trim() ? await resolveUserRef(body.from) : undefined;
    res.status(201).json(await createRequest({ requesterUserId: req.userId!, fromUserId, amountMinor: BigInt(body.amountMinor), currency: body.currency, memo: body.memo, ttlSecs: body.ttlSecs }));
  } catch (e) {
    next(e);
  }
});

paymentRequestsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.query.role === "received" ? "received" : "sent";
    res.json(await listRequests(req.userId!, role));
  } catch (e) {
    next(e);
  }
});

paymentRequestsRouter.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const r = await getRequest(req.params.id!);
    if (!r) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment request not found", retryable: false } }); return; }
    res.json(r);
  } catch (e) {
    next(e);
  }
});

paymentRequestsRouter.post("/:id/fulfill", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await fulfillRequest({ requestId: req.params.id!, payerUserId: req.userId! }));
  } catch (e) {
    next(e);
  }
});

paymentRequestsRouter.post("/:id/decline", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await declineRequest({ requestId: req.params.id!, userId: req.userId! }));
  } catch (e) {
    next(e);
  }
});

paymentRequestsRouter.post("/:id/cancel", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await cancelRequest({ requestId: req.params.id!, userId: req.userId! }));
  } catch (e) {
    next(e);
  }
});
