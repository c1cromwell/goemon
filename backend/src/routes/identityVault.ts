/**
 * Identity Vault — admin sync + user graph features.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError, ErrorCode } from "../errors";
import { syncFromLedger, getNeighborhood, graphFeaturesForUser } from "../services/identityVaultService";

export const identityVaultAdminRouter = Router();

identityVaultAdminRouter.post(
  "/identity-vault/sync",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await syncFromLedger());
    } catch (e) {
      next(e);
    }
  }
);

identityVaultAdminRouter.get(
  "/identity-vault/users/:userId/graph",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await getNeighborhood(req.params.userId!));
    } catch (e) {
      next(e);
    }
  }
);

export const identityVaultRouter = Router();

identityVaultRouter.get(
  "/features/:userId",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.userId !== req.params.userId) {
        throw new AppError(ErrorCode.FORBIDDEN, "Can only read own graph features");
      }
      res.json(await graphFeaturesForUser(req.params.userId!));
    } catch (e) {
      next(e);
    }
  }
);
