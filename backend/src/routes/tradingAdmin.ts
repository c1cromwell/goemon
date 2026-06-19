/**
 * Phase 17 Stage 2 — Trading admin (RBAC). Mounted at /api/admin.
 *
 * PATCH /api/admin/trading/accounts/:userId/options-level — raise options approval
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { setOptionsLevel, getTradingAccount } from "../services/tradingService";

export const tradingAdminRouter = Router();

tradingAdminRouter.get(
  "/trading/accounts/:userId",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await getTradingAccount(String(req.params.userId)));
    } catch (e) {
      next(e);
    }
  }
);

const optionsLevelSchema = z.object({
  optionsLevel: z.number().int().min(0).max(4),
});

tradingAdminRouter.patch(
  "/trading/accounts/:userId/options-level",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = optionsLevelSchema.parse(req.body);
      res.json(await setOptionsLevel(String(req.params.userId), body.optionsLevel));
    } catch (e) {
      next(e);
    }
  }
);
