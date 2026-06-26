/**
 * X-Money response F5 — collector/creator drops routes.
 *
 * POST /api/drops              — create a limited tokenized edition (creator, Tier 2)
 * GET  /api/drops              — active drops (or ?mine=1 for your created drops)
 * GET  /api/drops/claims       — editions you've claimed (own)
 * GET  /api/drops/:id          — one drop
 * POST /api/drops/:id/claim    — claim one edition (pay the creator; idempotent)
 *
 * Gated by CREATOR_DROPS_ENABLED inside the service. Claim moves money → Idempotency-Key.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { currencySchema } from "../services/currencyRegistry";
import { createDrop, listDrops, getDrop, claimDrop, myClaims } from "../services/creatorDropService";

export const dropsRouter = Router();

const amount = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

dropsRouter.post("/", requireAuth, requireTier(2), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(120),
      symbol: z.string().max(12).optional(),
      editionSize: z.number().int().positive(),
      priceMinor: amount,
      currency: currencySchema(),
      memo: z.string().max(500).optional(),
      certNumber: z.string().max(64).optional(),
    }).parse(req.body);
    res.status(201).json(await createDrop({ creatorUserId: req.userId!, name: body.name, symbol: body.symbol, editionSize: body.editionSize, priceMinor: BigInt(body.priceMinor), currency: body.currency, memo: body.memo, certNumber: body.certNumber }));
  } catch (e) {
    next(e);
  }
});

dropsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ drops: await listDrops(req.query.mine ? req.userId! : undefined) });
  } catch (e) {
    next(e);
  }
});

dropsRouter.get("/claims", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ claims: await myClaims(req.userId!) });
  } catch (e) {
    next(e);
  }
});

dropsRouter.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const d = await getDrop(req.params.id!);
    if (!d) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Drop not found", retryable: false } }); return; }
    res.json(d);
  } catch (e) {
    next(e);
  }
});

dropsRouter.post("/:id/claim", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await claimDrop({ dropId: req.params.id!, buyerUserId: req.userId!, idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});
