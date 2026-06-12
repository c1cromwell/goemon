/**
 * Phase 20 — Ledger⇄chain reconciliation (RBAC admin surface). Mounted at /api/admin.
 *
 * GET  /api/admin/reconciliation      — latest run, its findings, and the gate state
 * POST /api/admin/reconciliation/run  — run a reconciliation pass now
 *
 * Only compliance/admin roles. There is no manual "clear the gate" — settlement
 * un-gates only when a clean run supersedes the drifted one.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import { getLatestRun, runReconciliation, isSettlementGated } from "../services/reconciliationService";

export const reconciliationAdminRouter = Router();

reconciliationAdminRouter.get(
  "/reconciliation",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ latest: await getLatestRun(), settlementGated: await isSettlementGated() });
    } catch (e) {
      next(e);
    }
  }
);

reconciliationAdminRouter.post(
  "/reconciliation/run",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const run = await runReconciliation();
      res.json({ run, settlementGated: await isSettlementGated() });
    } catch (e) {
      next(e);
    }
  }
);
