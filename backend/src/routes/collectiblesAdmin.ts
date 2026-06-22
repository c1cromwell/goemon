/**
 * Admin — seller collectible submission human review queue.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import * as sellerCollectibles from "../services/sellerCollectibleService";

export const collectiblesAdminRouter = Router();

collectiblesAdminRouter.get(
  "/reviews",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const submissions = await sellerCollectibles.listPendingSubmissions();
      res.json({ submissions });
    } catch (e) {
      next(e);
    }
  }
);

collectiblesAdminRouter.get(
  "/reviews/:id",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const submission = await sellerCollectibles.getSubmission(req.params.id!);
      res.json({ submission });
    } catch (e) {
      next(e);
    }
  }
);

collectiblesAdminRouter.post(
  "/reviews/:id/approve",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const result = await sellerCollectibles.approveSubmission(req.params.id!, req.adminId!);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

collectiblesAdminRouter.post(
  "/reviews/:id/reject",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { reason } = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
      const submission = await sellerCollectibles.rejectSubmission(req.params.id!, req.adminId!, reason);
      res.json({ submission });
    } catch (e) {
      next(e);
    }
  }
);
