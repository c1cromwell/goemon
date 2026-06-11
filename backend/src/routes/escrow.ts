/**
 * Escrow & dispute — customer surface (docs/business/PAYMENT-NETWORK-STRATEGY.md §4).
 *
 * POST   /api/escrow             — hold a payment to a payee (payer; idempotent)
 * GET    /api/escrow             — escrows where you are payer or payee
 * GET    /api/escrow/:id         — one escrow (must be a party)
 * POST   /api/escrow/:id/release — payer releases held funds to the payee
 * POST   /api/escrow/:id/refund  — payee returns held funds to the payer
 * POST   /api/escrow/:id/dispute — either party opens a dispute (funds stay held)
 *
 * Money moves are balanced, idempotent ledger journals in escrowService. Mediated
 * dispute resolution is the RBAC admin surface (routes/escrowAdmin.ts).
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { getDb } from "../db";
import { hold, release, refund, openDispute, getEscrow, listEscrows } from "../services/escrowService";

export const escrowRouter = Router();

const MAX_ESCROW_MINOR = 10_000_000n; // $100,000 per hold

const holdSchema = z
  .object({
    payeeId: z.string().min(1).optional(),
    payeeEmail: z.string().email().optional(),
    amountMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
    currency: z.enum(["USD", "USDC"]).default("USD"),
    memo: z.string().max(500).optional(),
  })
  .refine((b) => b.payeeId || b.payeeEmail, { message: "payeeId or payeeEmail is required" });

async function resolvePayee(body: { payeeId?: string; payeeEmail?: string }): Promise<string> {
  if (body.payeeId) return body.payeeId;
  const row = await getDb().queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", [body.payeeEmail!.toLowerCase()]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Payee not found");
  return row.id;
}

/** Load an escrow and assert the caller is a party (payer or payee). */
async function requireParty(escrowId: string, userId: string) {
  const e = await getEscrow(escrowId);
  if (!e) throw new AppError(ErrorCode.NOT_FOUND, "Escrow not found");
  if (e.payerId !== userId && e.payeeId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Not a party to this escrow");
  return e;
}

escrowRouter.post("/", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = holdSchema.parse(req.body);
    const amount = BigInt(body.amountMinor);
    if (amount > MAX_ESCROW_MINOR) throw new AppError(ErrorCode.VALIDATION, `Amount exceeds maximum of ${MAX_ESCROW_MINOR}`);
    const payeeId = await resolvePayee(body);
    if (payeeId === req.userId) throw new AppError(ErrorCode.VALIDATION, "Cannot escrow to yourself");

    const result = await hold({
      payerId: req.userId!,
      payeeId,
      amountMinor: amount,
      currency: body.currency,
      memo: body.memo,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

escrowRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json(await listEscrows(req.userId!, limit));
  } catch (e) {
    next(e);
  }
});

escrowRouter.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await requireParty(req.params.id!, req.userId!));
  } catch (e) {
    next(e);
  }
});

escrowRouter.post("/:id/release", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const e = await requireParty(req.params.id!, req.userId!);
    if (e.payerId !== req.userId) throw new AppError(ErrorCode.FORBIDDEN, "Only the payer can release");
    res.json(await release(e.id, req.userId!));
  } catch (e) {
    next(e);
  }
});

escrowRouter.post("/:id/refund", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const e = await requireParty(req.params.id!, req.userId!);
    if (e.payeeId !== req.userId) throw new AppError(ErrorCode.FORBIDDEN, "Only the payee can refund");
    res.json(await refund(e.id, req.userId!));
  } catch (e) {
    next(e);
  }
});

const disputeSchema = z.object({ reason: z.string().min(1).max(500) });

escrowRouter.post("/:id/dispute", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const e = await requireParty(req.params.id!, req.userId!);
    const body = disputeSchema.parse(req.body);
    res.json(await openDispute(e.id, body.reason, req.userId!));
  } catch (e) {
    next(e);
  }
});
