/**
 * Fiat → USDC on-ramp API (customer surface). Mounted at /api/onramp.
 *
 *   POST /api/onramp/quote     { fiatAmountMinor, fiatCurrency? }          → OnRampQuote
 *   POST /api/onramp/order     { fiatAmountMinor, fiatCurrency? }          (Idempotency-Key) → OnRampOrder
 *   GET  /api/onramp/orders                                               → OnRampOrder[]
 *   GET  /api/onramp/orders/:id                                          → OnRampOrder
 *
 * The order route requires an Idempotency-Key (idempotency() middleware). Gated by
 * ONRAMP_ENABLED via the service (ONRAMP_DISABLED when off). No tier gate: the licensed
 * on-ramp provider runs KYC/AML under its own license, so buying the first USDC is the
 * frictionless activation step — Goeman only credits the delivered USDC into the ledger.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { quote, createOrder, getOrder, listOrders } from "../services/onRampService";

export const onrampRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "fiatAmountMinor must be a positive integer (minor units)");
  }
}

const bodySchema = z.object({
  fiatAmountMinor: z.union([z.string(), z.number()]),
  fiatCurrency: z.string().optional(),
});

onrampRouter.post("/quote", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = bodySchema.parse(req.body);
    const q = quote({ fiatAmountMinor: amount(body.fiatAmountMinor), fiatCurrency: body.fiatCurrency });
    res.json({
      provider: q.provider, fiatAmountMinor: q.fiatAmountMinor.toString(), fiatCurrency: q.fiatCurrency, asset: q.asset,
      usdcGrossMinor: q.usdcGrossMinor.toString(), feeMinor: q.feeMinor.toString(), usdcNetMinor: q.usdcNetMinor.toString(),
      ratePpm: q.ratePpm, feeBps: q.feeBps,
    });
  } catch (e) {
    next(e);
  }
});

onrampRouter.post("/order", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = bodySchema.parse(req.body);
    const order = await createOrder({
      userId: req.userId!,
      fiatAmountMinor: amount(body.fiatAmountMinor),
      fiatCurrency: body.fiatCurrency,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

onrampRouter.get("/orders", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await listOrders(req.userId!));
  } catch (e) {
    next(e);
  }
});

onrampRouter.get("/orders/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getOrder(req.userId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});
