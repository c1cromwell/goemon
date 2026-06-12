/**
 * Phase 21 Stage 1 — Argus Pay routes (the native rail's customer + merchant surface).
 *
 * POST   /api/pay/merchants            — register a merchant (Tier 2; you are the settlement account)
 * GET    /api/pay/merchants            — your merchants
 * POST   /api/pay/intents              — merchant requests money (idempotent)
 * GET    /api/pay/intents?role=…       — your intents as merchant | payer
 * GET    /api/pay/intents/:id          — one intent (any authenticated user — a payment-request link)
 * POST   /api/pay/intents/:id/pay      — pay it (escrow-protected; idempotent per intent)
 * POST   /api/pay/intents/:id/capture  — merchant captures held funds
 * POST   /api/pay/intents/:id/refund   — merchant refunds the payer
 * POST   /api/pay/intents/:id/dispute  — payer disputes (funds stay held; admin mediates)
 * POST   /api/pay/intents/:id/cancel   — merchant cancels an unpaid intent
 *
 * Money moves are balanced, idempotent ledger journals via the escrow layer
 * (paymentService → escrowService). Gated by the ARGUS_PAY_ENABLED kill-switch
 * inside the service (new intents/payments only — held funds always resolvable).
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import {
  createMerchant,
  listMerchants,
  createPaymentIntent,
  getIntent,
  listIntents,
  payIntent,
  captureIntent,
  refundIntent,
  disputeIntent,
  cancelIntent,
} from "../services/paymentService";

export const payRouter = Router();

payRouter.post("/merchants", requireAuth, requireTier(2), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ name: z.string().min(1).max(120) }).parse(req.body);
    res.status(201).json(await createMerchant(req.userId!, body.name));
  } catch (e) {
    next(e);
  }
});

payRouter.get("/merchants", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await listMerchants(req.userId!));
  } catch (e) {
    next(e);
  }
});

const createIntentSchema = z.object({
  merchantId: z.string().min(1),
  amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  currency: z.enum(["USD", "USDC"]).default("USD"),
  memo: z.string().max(500).optional(),
  ttlSecs: z.number().int().positive().optional(),
});

payRouter.post("/intents", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = createIntentSchema.parse(req.body);
    const result = await createPaymentIntent({
      merchantId: body.merchantId,
      actorUserId: req.userId!,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      memo: body.memo,
      ttlSecs: body.ttlSecs,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

payRouter.get("/intents", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.query.role === "payer" ? "payer" : "merchant";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json(await listIntents(req.userId!, role, limit));
  } catch (e) {
    next(e);
  }
});

payRouter.get("/intents/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const intent = await getIntent(req.params.id!);
    if (!intent) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment intent not found", retryable: false } });
      return;
    }
    res.json(intent);
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/pay", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await payIntent({ intentId: req.params.id!, payerUserId: req.userId!, authorizedVia: "user" }));
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/capture", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await captureIntent(req.params.id!, req.userId!));
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/refund", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await refundIntent(req.params.id!, req.userId!));
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/dispute", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
    res.json(await disputeIntent(req.params.id!, req.userId!, body.reason));
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/cancel", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await cancelIntent(req.params.id!, req.userId!));
  } catch (e) {
    next(e);
  }
});
