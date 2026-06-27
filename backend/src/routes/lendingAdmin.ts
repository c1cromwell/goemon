/**
 * Collateralized lending (RBAC admin/ops surface). Mounted at /api/admin.
 *
 *   POST /api/admin/lending/loans/:id/accrue     { periodDays? }  — advance interest accrual
 *   POST /api/admin/lending/loans/:id/liquidate                   — liquidate if under-water
 *
 * compliance/admin only. (The risk loop would call these on a schedule in production.)
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { accrueInterest, liquidate } from "../services/lendingService";

export const lendingAdminRouter = Router();

lendingAdminRouter.post(
  "/lending/loans/:id/accrue",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z.object({ periodDays: z.number().positive().optional() }).parse(req.body ?? {});
      res.json(await accrueInterest(req.params.id!, { periodDays: body.periodDays }));
    } catch (e) {
      next(e);
    }
  }
);

lendingAdminRouter.post(
  "/lending/loans/:id/liquidate",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await liquidate(req.params.id!));
    } catch (e) {
      next(e);
    }
  }
);
