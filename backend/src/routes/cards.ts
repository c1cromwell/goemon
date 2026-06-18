/**
 * Phase 19.4 — debit cards API (customer surface). Mounted at /api/cards.
 *
 *   POST /api/cards                          — issue a card (Tier 2)
 *   GET  /api/cards                          — your cards
 *   POST /api/cards/:id/authorize            { amountMinor, merchant? }  (Idempotency-Key) — simulate a purchase
 *   POST /api/cards/authorizations/:id/void  — cancel an uncaptured auth
 *   GET  /api/cards/authorizations           — your authorizations
 *
 * Capture + refund are the merchant/processor side → /api/admin/cards (cardAdmin.ts).
 * All gated by CARDS_ENABLED via the service (CARDS_DISABLED when off).
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { issueCard, listCards, authorize, voidAuthorization, listAuthorizations } from "../services/cardService";

export const cardsRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "amountMinor must be a positive integer (minor units)");
  }
}

cardsRouter.post("/", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    res.status(201).json(await issueCard(req.userId!));
  } catch (e) {
    next(e);
  }
});

cardsRouter.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ cards: await listCards(req.userId!) });
  } catch (e) {
    next(e);
  }
});

cardsRouter.get("/authorizations", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ authorizations: await listAuthorizations(req.userId!) });
  } catch (e) {
    next(e);
  }
});

cardsRouter.post("/:id/authorize", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]), merchant: z.string().optional() }).parse(req.body);
    const auth = await authorize({
      userId: req.userId!,
      cardId: req.params.id!,
      amountMinor: amount(body.amountMinor),
      merchant: body.merchant,
      idempotencyKey: req.header("Idempotency-Key")!,
      channel: "card",
    });
    res.status(201).json(auth);
  } catch (e) {
    next(e);
  }
});

cardsRouter.post("/authorizations/:id/void", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await voidAuthorization(req.params.id!));
  } catch (e) {
    next(e);
  }
});
