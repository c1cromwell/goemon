/**
 * Escrow & dispute — mediator (RBAC admin) surface. Mounted at /api/admin.
 *
 * GET  /api/admin/escrow/disputes      — the open-dispute work queue
 * POST /api/admin/escrow/:id/resolve   — resolve a dispute (release | refund)
 *
 * Only compliance/admin roles may mediate. The money move is the same balanced,
 * idempotent escrow journal as the customer surface — humans gate, code executes.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { listDisputed, resolveDispute } from "../services/escrowService";
import { syncFromEscrowResolution } from "../services/collectiblePurchaseService";

export const escrowAdminRouter = Router();

escrowAdminRouter.get(
  "/escrow/disputes",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await listDisputed());
    } catch (e) {
      next(e);
    }
  }
);

escrowAdminRouter.post(
  "/escrow/:id/resolve",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { outcome } = z.object({ outcome: z.enum(["release", "refund"]) }).parse(req.body);
      const result = await resolveDispute(req.params.id!, outcome, req.adminId!);
      await syncFromEscrowResolution(req.params.id!, outcome);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);
