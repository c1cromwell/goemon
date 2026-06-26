/**
 * X-Money response F1 — tokenized Treasury routes.
 *
 * GET  /api/treasury            — the treasury asset + your position + recent yield
 * POST /api/treasury/subscribe  — buy tokens at par (cash → asset you own); idempotent
 * POST /api/treasury/redeem     — sell tokens back to cash at par; idempotent
 * POST /api/admin/treasury/accrue — (RBAC) accrue + distribute the period's yield pro-rata
 *
 * Gated by TREASURY_ENABLED inside the service. Subscribe/redeem move money → require
 * an Idempotency-Key. Accrue is an operational action (pays every holder) → admin/compliance.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { subscribe, redeem, positions, accrueYield } from "../services/treasuryService";

const qty = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

export const treasuryRouter = Router();

treasuryRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await positions(req.userId!));
  } catch (e) {
    next(e);
  }
});

treasuryRouter.post("/subscribe", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ qtyBase: qty }).parse(req.body);
    res.json(await subscribe({ userId: req.userId!, qtyBase: BigInt(body.qtyBase), idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});

treasuryRouter.post("/redeem", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ qtyBase: qty }).parse(req.body);
    res.json(await redeem({ userId: req.userId!, qtyBase: BigInt(body.qtyBase), idempotencyKey: req.header("Idempotency-Key")! }));
  } catch (e) {
    next(e);
  }
});

export const treasuryAdminRouter = Router();

treasuryAdminRouter.post(
  "/treasury/accrue",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ assetId: z.string().optional(), periodDays: z.number().int().positive().optional(), apyBps: z.number().int().nonnegative().optional() }).parse(req.body ?? {});
      res.json(await accrueYield(body));
    } catch (e) {
      next(e);
    }
  }
);
