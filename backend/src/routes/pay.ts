/**
 * Phase 21 Stage 1 — Goeman Pay routes (the native rail's customer + merchant surface).
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
 * (paymentService → escrowService). Gated by the GOEMAN_PAY_ENABLED kill-switch
 * inside the service (new intents/payments only — held funds always resolvable).
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, getClientIp, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { vpVerifyTotal } from "../observability/metrics";
import { currencySchema } from "../services/currencyRegistry";
import { issueCheckoutChallenge, verifyCheckoutPresentation } from "../services/presentationService";
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

function assertCheckoutVpEnabled(): void {
  if (!config.CHECKOUT_VP_ENABLED) {
    throw new AppError(ErrorCode.FORBIDDEN, "Login-less checkout (Verifiable Presentation) is not enabled");
  }
}

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
  currency: currencySchema(),
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

// ---------------------------------------------------------------------------
// Login-less checkout via Verifiable Presentation (NO session / NO redirect).
//
// The customer's device proves who they are with a VC-backed VP instead of
// logging into a provider. There is intentionally no requireAuth here: trust is
// established entirely by the VP signature + nonce + holder-binding checks in
// presentationService (the same cardinal rule as /api/present). The payer is
// derived from the verified credential, never from a caller-supplied id.
//
// POST /api/pay/intents/:id/checkout/challenge      — get a VP challenge for this intent
// POST /api/pay/intents/:id/pay-with-presentation   — pay it by presenting the VP
// ---------------------------------------------------------------------------

payRouter.post("/intents/:id/checkout/challenge", async (req, res, next) => {
  try {
    assertCheckoutVpEnabled();
    const intent = await getIntent(req.params.id!);
    if (!intent) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment intent not found", retryable: false } });
      return;
    }
    if (intent.status !== "requires_payment") {
      throw new AppError(ErrorCode.CONFLICT, `Intent is ${intent.status}, not payable`);
    }
    const challenge = await issueCheckoutChallenge(intent.id);
    // Echo back what the wallet is being asked to authorize (display, not trust).
    res.json({
      ...challenge,
      intentId: intent.id,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      merchantName: intent.merchantName,
      memo: intent.memo,
    });
  } catch (e) {
    next(e);
  }
});

payRouter.post("/intents/:id/pay-with-presentation", async (req, res, next) => {
  try {
    assertCheckoutVpEnabled();
    const { vpJwt } = z.object({ vpJwt: z.string().min(1) }).parse(req.body);
    let pres;
    try {
      pres = await verifyCheckoutPresentation({ vpJwt, intentId: req.params.id!, ipAddress: getClientIp(req) });
      vpVerifyTotal.inc({ result: "success" });
    } catch (e) {
      vpVerifyTotal.inc({ result: "rejected" });
      throw e;
    }
    const intent = await payIntent({ intentId: req.params.id!, payerUserId: pres.userId, authorizedVia: "vp" });
    res.json({ intent, payer: { userId: pres.userId, walletDid: pres.walletDid }, authorizedVia: "vp" });
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
