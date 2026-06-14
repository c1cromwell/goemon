/**
 * Phase 15 — Internal agent operations (RBAC admin surface). Mounted at /api/admin.
 *
 * POST /api/admin/agent-ops/kyc-review        — run the KYC-review workflow for a user
 * GET  /api/admin/agent-ops/reviews?status=   — the human-review queue
 * GET  /api/admin/agent-ops/runs/:workflowRun — the append-only run trail
 * POST /api/admin/agent-ops/reviews/:id/decision — resolve a queued review (RBAC gate)
 *
 * Any admin may trigger a review or read the queue; only compliance/admin may decide
 * (also enforced inside resolveReview against the review's requires_role).
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { AppError, ErrorCode } from "../errors";
import { runOperation, listReviews, getRunTrail, resolveReview, type AgentReviewRow, type WorkflowDef } from "../operations/operationsWorkflow";
import { kycReviewWorkflow } from "../operations/skills/kycReviewSkill";

export const agentOpsAdminRouter = Router();

agentOpsAdminRouter.post(
  "/agent-ops/kyc-review",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { userId, fullName, documentNumber } = (req.body ?? {}) as {
        userId?: string; fullName?: string; documentNumber?: string;
      };
      if (!userId) throw new AppError(ErrorCode.VALIDATION, "userId required");
      const result = await runOperation(kycReviewWorkflow as WorkflowDef, { userId, fullName, documentNumber });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

agentOpsAdminRouter.get(
  "/agent-ops/reviews",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as AgentReviewRow["status"]) || "pending";
      res.json({ reviews: await listReviews(status) });
    } catch (e) {
      next(e);
    }
  }
);

agentOpsAdminRouter.get(
  "/agent-ops/runs/:workflowRun",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ runs: await getRunTrail(req.params.workflowRun!) });
    } catch (e) {
      next(e);
    }
  }
);

agentOpsAdminRouter.post(
  "/agent-ops/reviews/:id/decision",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { decision, reason } = (req.body ?? {}) as { decision?: "approve" | "reject"; reason?: string };
      if (decision !== "approve" && decision !== "reject") {
        throw new AppError(ErrorCode.VALIDATION, "decision must be 'approve' or 'reject'");
      }
      const result = await resolveReview(
        req.params.id!,
        { adminId: req.adminId!, role: req.adminRole! },
        decision,
        reason
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);
