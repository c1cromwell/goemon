/**
 * FX surface.
 *
 * GET  /api/fx/currencies   — the enabled currency registry (public).
 * POST /api/fx/quote        — { from, to, amountMinor } → a conversion quote (public, no ledger).
 * POST /api/fx/convert      — { from, to, fromAmountMinor } → settle the conversion (auth + idempotent).
 * GET  /api/fx/conversions  — the user's conversion history (auth).
 *
 * Quotes are read-only (gated by FX_ENABLED). Convert MOVES money (auth +
 * Idempotency-Key; gated by FX_SETTLEMENT_ENABLED inside the service).
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { listCurrencies } from "../services/currencyRegistry";
import { quote } from "../services/fxRateService";
import { convert, listConversions } from "../services/fxSettlementService";

export const fxRouter = Router();

fxRouter.get("/currencies", (_req, res) => {
  res.json({ currencies: listCurrencies() });
});

const amount = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

fxRouter.post("/quote", async (req, res, next) => {
  try {
    const body = z.object({ from: z.string().min(1), to: z.string().min(1), amountMinor: amount }).parse(req.body);
    res.json(await quote({ from: body.from, to: body.to, amountMinor: BigInt(body.amountMinor) }));
  } catch (e) {
    next(e);
  }
});

fxRouter.post("/convert", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ from: z.string().min(1), to: z.string().min(1), fromAmountMinor: amount }).parse(req.body);
    res.json(
      await convert({
        userId: req.userId!,
        from: body.from,
        to: body.to,
        fromAmountMinor: BigInt(body.fromAmountMinor),
        idempotencyKey: req.header("Idempotency-Key")!,
      })
    );
  } catch (e) {
    next(e);
  }
});

fxRouter.get("/conversions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ conversions: await listConversions(req.userId!) });
  } catch (e) {
    next(e);
  }
});
