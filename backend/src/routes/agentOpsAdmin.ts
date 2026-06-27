/**
 * Phase 15 + M2 — Internal agent operations & CEO approvals (RBAC admin surface).
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { AppError, ErrorCode } from "../errors";
import {
  runOperation,
  listReviews,
  listReviewsForActor,
  listOverdueReviews,
  getRunTrail,
  resolveReview,
  getWorkflow,
  type AgentReviewRow,
  type WorkflowDef,
} from "../operations/operationsWorkflow";
import { kycReviewWorkflow } from "../operations/skills/kycReviewSkill";
import { listMilestoneStatuses, signMilestone } from "../services/milestoneSignoffService";
import "../operations/skills";

export const agentOpsAdminRouter = Router();

const APPROVER_ROLES = ["compliance", "admin", "ceo", "chief_of_staff"] as const;

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

agentOpsAdminRouter.post(
  "/agent-ops/run",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { skill, input } = (req.body ?? {}) as { skill?: string; input?: unknown };
      if (!skill) throw new AppError(ErrorCode.VALIDATION, "skill required");
      const def = getWorkflow(skill);
      if (!def) throw new AppError(ErrorCode.NOT_FOUND, `No registered workflow for skill ${skill}`);
      res.json(await runOperation(def, input ?? {}));
    } catch (e) {
      next(e);
    }
  }
);

/** Pending human gates — optional ?mine=1 filters to reviews this actor may resolve. */
agentOpsAdminRouter.get(
  "/agent-ops/reviews",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as AgentReviewRow["status"]) || "pending";
      const mine = req.query.mine === "1" || req.query.mine === "true";
      const reviews = mine
        ? await listReviewsForActor(req.adminRole!, status)
        : await listReviews(status);
      res.json({ reviews });
    } catch (e) {
      next(e);
    }
  }
);

/** CEO Approvals queue alias — pending reviews the signed-in actor can resolve. */
agentOpsAdminRouter.get(
  "/agent-ops/approvals",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as AgentReviewRow["status"]) || "pending";
      res.json({ reviews: await listReviewsForActor(req.adminRole!, status) });
    } catch (e) {
      next(e);
    }
  }
);

agentOpsAdminRouter.get(
  "/agent-ops/reviews/overdue",
  requireAdmin,
  requireRole("compliance", "admin", "ceo", "chief_of_staff"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ overdue: await listOverdueReviews() });
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
  requireRole(...APPROVER_ROLES),
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

/** M2 — milestone deploy sign-off status (M1–M6). */
agentOpsAdminRouter.get(
  "/agent-ops/milestones",
  requireAdmin,
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ milestones: await listMilestoneStatuses() });
    } catch (e) {
      next(e);
    }
  }
);

agentOpsAdminRouter.post(
  "/agent-ops/milestones/:id/signoff",
  requireAdmin,
  requireRole("ceo", "chief_of_staff", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { note } = (req.body ?? {}) as { note?: string };
      const milestone = await signMilestone(req.params.id!, { adminId: req.adminId!, role: req.adminRole! }, note);
      res.json({ milestone });
    } catch (e) {
      next(e);
    }
  }
);
