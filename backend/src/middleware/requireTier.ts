/**
 * Phase 3 — Tier-gating middleware.
 *
 * Mount AFTER requireAuth. Reads the identity_profiles tier and rejects
 * requests from users below the required tier with TIER_REQUIRED.
 */

import type { Response, NextFunction } from "express";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import type { AuthRequest } from "./auth";

export function requireTier(minTier: number) {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.userId) {
      next(new AppError(ErrorCode.UNAUTHENTICATED, "Authentication required"));
      return;
    }
    const profile = await getDb().queryOne<{ tier: number }>(
      "SELECT tier FROM identity_profiles WHERE user_id = ?",
      [req.userId]
    );
    const tier = profile?.tier ?? 0;
    if (tier < minTier) {
      next(new AppError(ErrorCode.TIER_REQUIRED, `Tier ${minTier} required (current: ${tier})`));
      return;
    }
    next();
  };
}
