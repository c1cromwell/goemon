/**
 * Phase 5A — Agentic account-opening routes (user-facing).
 *
 * POST /api/onboarding/start      — begin a risk-adaptive onboarding session
 * POST /api/onboarding/document   — submit a document for the document-validation agent
 * POST /api/onboarding/possession — submit a possession proof for the possession agent
 * GET  /api/onboarding/status     — current session, scores, required steps, decision trail
 *
 * The applicant's email comes from their user record and the client IP from req.ip;
 * neither is echoed back. Only the minimized signal summary + decision are returned.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, getClientIp, type AuthRequest } from "../middleware/auth";
import { AppError, ErrorCode } from "../errors";
import { getUserById } from "../services/authService";
import * as orchestrator from "../services/riskOrchestratorService";

export const onboardingRouter = Router();

onboardingRouter.post("/start", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { deviceFingerprint, rapidCompletion } = req.body as {
      deviceFingerprint?: string;
      rapidCompletion?: boolean;
    };
    const user = await getUserById(req.userId!);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found");
    const view = await orchestrator.startOnboarding(req.userId!, {
      email: user.email,
      ip: getClientIp(req),
      deviceFingerprint,
      rapidCompletion: rapidCompletion === true,
    });
    res.json(view);
  } catch (e) {
    next(e);
  }
});

onboardingRouter.post("/document", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { documentNumber, documentType, fullName, dob, country } = req.body as {
      documentNumber?: string;
      documentType?: string;
      fullName?: string;
      dob?: string;
      country?: string;
    };
    if (!documentNumber) throw new AppError(ErrorCode.VALIDATION, "documentNumber required");
    const view = await orchestrator.submitDocument(req.userId!, { documentNumber, documentType, fullName, dob, country });
    res.json(view);
  } catch (e) {
    next(e);
  }
});

onboardingRouter.post("/possession", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, factor } = req.body as { code?: string; factor?: "email_otp" | "sms_otp" | "device" };
    const view = await orchestrator.submitPossession(req.userId!, { code, factor });
    res.json(view);
  } catch (e) {
    next(e);
  }
});

onboardingRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const view = await orchestrator.getStatus(req.userId!);
    if (!view) throw new AppError(ErrorCode.NOT_FOUND, "No onboarding session");
    res.json(view);
  } catch (e) {
    next(e);
  }
});
