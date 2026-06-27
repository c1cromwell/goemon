/**
 * USDC → fiat off-ramp API (customer surface). Mounted at /api/offramp.
 *
 *   POST /api/offramp/quote    { usdcAmountMinor, fiatCurrency? }              → OffRampQuote
 *   POST /api/offramp/order    { usdcAmountMinor, fiatCurrency?, destination? } (Idempotency-Key) → OffRampOrder
 *   GET  /api/offramp/orders                                                  → OffRampOrder[]
 *   GET  /api/offramp/orders/:id                                              → OffRampOrder
 *
 * The order route requires an Idempotency-Key. Money leaving the platform, so the service
 * applies the freeze + fraud-screen + balance guards. Gated by OFFRAMP_ENABLED.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { quote, createOrder, getOrder, listOrders } from "../services/offRampService";

export const offrampRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "usdcAmountMinor must be a positive integer (minor units)");
  }
}

offrampRouter.post("/quote", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ usdcAmountMinor: z.union([z.string(), z.number()]), fiatCurrency: z.string().optional() }).parse(req.body);
    const q = quote({ usdcAmountMinor: amount(body.usdcAmountMinor), fiatCurrency: body.fiatCurrency });
    res.json({
      provider: q.provider, usdcAmountMinor: q.usdcAmountMinor.toString(), feeMinor: q.feeMinor.toString(), usdcNetMinor: q.usdcNetMinor.toString(),
      fiatAmountMinor: q.fiatAmountMinor.toString(), fiatCurrency: q.fiatCurrency, asset: q.asset, ratePpm: q.ratePpm, feeBps: q.feeBps,
    });
  } catch (e) {
    next(e);
  }
});

offrampRouter.post("/order", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      usdcAmountMinor: z.union([z.string(), z.number()]),
      fiatCurrency: z.string().optional(),
      destination: z.string().max(64).optional(),
    }).parse(req.body);
    const order = await createOrder({
      userId: req.userId!,
      usdcAmountMinor: amount(body.usdcAmountMinor),
      fiatCurrency: body.fiatCurrency,
      destination: body.destination,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

offrampRouter.get("/orders", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await listOrders(req.userId!));
  } catch (e) {
    next(e);
  }
});

offrampRouter.get("/orders/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await getOrder(req.userId!, req.params.id!));
  } catch (e) {
    next(e);
  }
});
