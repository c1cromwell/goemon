/**
 * Phase 3 — Identity routes.
 *
 * GET  /api/identity/profile       — get tier profile
 * POST /api/identity/tier1         — submit phone (upgrade to Tier 1)
 * POST /api/identity/tier2/start   — initiate KYC (simulated)
 * POST /api/identity/tier2/complete — complete simulated KYC (dev/test only)
 * GET  /api/identity/tier2/status  — KYC status
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { config } from "../config";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError, ErrorCode } from "../errors";
import * as identityService from "../services/identityService";

export const identityRouter = Router();

identityRouter.get("/profile", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const profile = await identityService.getProfile(req.userId!);
    if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Profile not found");
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

identityRouter.post("/tier1", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.body as { phone?: string };
    if (!phone) throw new AppError(ErrorCode.VALIDATION, "phone required");
    const profile = await identityService.upgradeTier1(req.userId!, phone);
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

identityRouter.post("/tier2/start", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fullName, dob, country } = req.body as { fullName?: string; dob?: string; country?: string };
    if (!fullName || !dob) throw new AppError(ErrorCode.VALIDATION, "fullName and dob required");
    const result = await identityService.initiateKyc(req.userId!, fullName, dob, country ?? "US");
    res.json(result);
  } catch (e) {
    next(e);
  }
});

identityRouter.post("/tier2/complete", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (config.isProd) throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Use the IDV webhook in production");
    const profile = await identityService.completeSimulatedKyc(req.userId!);
    res.json(profile);
  } catch (e) {
    next(e);
  }
});

identityRouter.get("/tier2/status", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = await identityService.getKycStatus(req.userId!);
    res.json(status);
  } catch (e) {
    next(e);
  }
});
