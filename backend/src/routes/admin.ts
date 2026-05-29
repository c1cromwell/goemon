/**
 * Phase 5A — Admin console routes (RBAC-gated).
 *
 * POST /api/admin/seed                                  — create the default admin (idempotent)
 * POST /api/admin/login                                 — admin password login → admin JWT
 * GET  /api/admin/identities                            — list ALL registered identities
 * GET  /api/admin/identities/:userId                    — full identity detail + decision trail
 * GET  /api/admin/onboarding/sessions?status=…          — review queue
 * POST /api/admin/onboarding/sessions/:id/decision      — human review (compliance/admin)
 * POST /api/admin/simulations                           — generate simulated demo identities
 *
 * Read routes require any admin; the review decision requires compliance/admin.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode } from "../errors";
import { requireAdmin, requireRole, signAdminSession, type AdminRequest } from "../middleware/rbac";
import * as adminService from "../services/adminService";

export const adminRouter = Router();

adminRouter.post("/seed", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await adminService.seedAdmin();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new AppError(ErrorCode.VALIDATION, "email and password required");
    const { adminId, role } = await adminService.authenticateAdmin(email, password);
    const token = signAdminSession(adminId, role);
    res.json({ token, role });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/identities", requireAdmin, async (_req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await adminService.listIdentities());
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/identities/:userId", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.params.userId;
    if (!userId) throw new AppError(ErrorCode.VALIDATION, "userId required");
    res.json(await adminService.getIdentityDetail(userId));
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/onboarding/sessions", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const status = (req.query.status as string) || "review_required";
    res.json(await adminService.listReviewQueue(status));
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  "/onboarding/sessions/:id/decision",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { approve, note } = req.body as { approve?: boolean; note?: string };
      const sessionId = req.params.id;
      if (!sessionId) throw new AppError(ErrorCode.VALIDATION, "session id required");
      if (typeof approve !== "boolean") throw new AppError(ErrorCode.VALIDATION, "approve (boolean) required");
      const view = await adminService.decideReview(req.adminId!, sessionId, approve, note);
      res.json(view);
    } catch (e) {
      next(e);
    }
  }
);

adminRouter.post("/simulations", requireAdmin, async (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const { profiles } = req.body as { profiles?: string[] };
    const results = await adminService.createSimulatedIdentities(
      Array.isArray(profiles) && profiles.length > 0 ? profiles : undefined
    );
    res.json({ results });
  } catch (e) {
    next(e);
  }
});
