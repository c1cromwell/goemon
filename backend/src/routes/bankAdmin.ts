/**
 * Phase 19 Stage-1 — full-bank rails (RBAC admin/ops surface). Mounted at /api/admin.
 *
 * POST /api/admin/bank/transfers/:id/return  — process an ACH return / failed payout (reverses the journal)
 * GET  /api/admin/bank/fbo?currency=         — FBO coverage: partner-bank balance vs total customer cash
 *
 * compliance/admin only.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { returnTransfer, fboCoverage } from "../services/bankRailService";
import { capture, refund } from "../services/cardService";
import { processScheduledBills } from "../services/billPayService";

export const bankAdminRouter = Router();

bankAdminRouter.post(
  "/bank/transfers/:id/return",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await returnTransfer(req.params.id!));
    } catch (e) {
      next(e);
    }
  }
);

bankAdminRouter.get(
  "/bank/fbo",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const currency = typeof req.query.currency === "string" ? req.query.currency : "USD";
      const c = await fboCoverage(currency);
      res.json({ currency, liabilityMinor: c.liabilityMinor.toString(), fboBalanceMinor: c.fboBalanceMinor.toString(), covered: c.covered });
    } catch (e) {
      next(e);
    }
  }
);

// Phase 19.4 — card capture/refund (the merchant/processor settlement side).
bankAdminRouter.post(
  "/cards/authorizations/:id/capture",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await capture(req.params.id!));
    } catch (e) {
      next(e);
    }
  }
);

bankAdminRouter.post(
  "/cards/authorizations/:id/refund",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await refund(req.params.id!));
    } catch (e) {
      next(e);
    }
  }
);

// Phase 19.3 — settle all due scheduled bill payments (the ops due-loop).
bankAdminRouter.post(
  "/billpay/process",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await processScheduledBills());
    } catch (e) {
      next(e);
    }
  }
);
