/**
 * Phase 24.2 — x402 agent commerce routes + demo paywalled resource.
 */

import { Router } from "express";
import { z } from "zod";
import { getClientIp, requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { currencySchema } from "../services/currencyRegistry";
import { getIntent } from "../services/paymentService";
import {
  X402_HEADER_FULFILLMENT,
  X402_HEADER_REQUIRED,
  buildPaymentRequiredForIntent,
  createAgentCommerceIntent,
  fulfillPayment,
} from "../services/x402Service";
import { X401_VERIFICATION_TOKEN_HEADER } from "../services/x401Service";
import { isProductAvailable } from "../services/productCatalogService";

export const x402Router = Router();

x402Router.get("/intents/:id/requirement", async (req, res, next) => {
  try {
    const intent = await getIntent(req.params.id!);
    if (!intent) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment intent not found", retryable: false } });
      return;
    }
    const built = await buildPaymentRequiredForIntent(intent, req.query.resource as string | undefined);
    res.setHeader(X402_HEADER_REQUIRED, built.header);
    res.status(402).json({ payment_required: built.payload });
  } catch (e) {
    next(e);
  }
});

x402Router.post("/fulfill", async (req, res, next) => {
  try {
    const header =
      (req.header(X402_HEADER_FULFILLMENT) as string | undefined) ??
      (req.body?.fulfillmentHeader as string | undefined);
    if (!header) {
      res.status(400).json({ error: { code: "VALIDATION", message: "PAYMENT-FULFILLMENT header required", retryable: false } });
      return;
    }
    const result = await fulfillPayment({ fulfillmentHeader: header, ipAddress: getClientIp(req) });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

x402Router.post(
  "/intents",
  requireAuth,
  idempotency(),
  async (req: AuthRequest, res, next) => {
    try {
      const body = z
        .object({
          merchantId: z.string().min(1),
          amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
          currency: currencySchema(),
          memo: z.string().max(500).optional(),
        })
        .parse(req.body);
      const intent = await createAgentCommerceIntent({
        merchantId: body.merchantId,
        ownerUserId: req.userId!,
        amountMinor: BigInt(body.amountMinor),
        currency: body.currency,
        memo: body.memo,
        idempotencyKey: req.header("Idempotency-Key")!,
      });
      res.status(201).json(intent);
    } catch (e) {
      next(e);
    }
  }
);

/** Demo: paywalled content — 402 until PAYMENT-FULFILLMENT succeeds. Optional x401 token in query for agent path. */
x402Router.get("/demo/premium/:slug", async (req, res, next) => {
  try {
    if (!isProductAvailable("agent.x402.commerce")) {
      res.status(503).json({ error: { code: "NOT_IMPLEMENTED", message: "x402 commerce not enabled", retryable: false } });
      return;
    }
    const intentId = req.query.intentId as string | undefined;
    const paid = req.query.paid === "1";
    if (paid && intentId) {
      const intent = await getIntent(intentId);
      if (intent && (intent.status === "held" || intent.status === "settled")) {
        res.json({ slug: req.params.slug, content: "Premium agent-commerce payload", intentId });
        return;
      }
    }
    if (!intentId) {
      res.status(400).json({
        error: { code: "VALIDATION", message: "Create a payment intent first; pass intentId query param", retryable: false },
      });
      return;
    }
    const intent = await getIntent(intentId);
    if (!intent) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment intent not found", retryable: false } });
      return;
    }
    const built = await buildPaymentRequiredForIntent(intent, `/demo/premium/${req.params.slug}`);
    res.setHeader(X402_HEADER_REQUIRED, built.header);
    res.status(402).json({
      error: { code: "PAYMENT_REQUIRED", message: "Payment required — send PAYMENT-FULFILLMENT", retryable: true },
      payment_required: built.payload,
      hint: { x401_token_header: X401_VERIFICATION_TOKEN_HEADER },
    });
  } catch (e) {
    next(e);
  }
});
