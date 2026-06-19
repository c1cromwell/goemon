/**
 * Phase 20 — Data warehouse export (RBAC admin surface). Mounted at /api/admin.
 *
 * GET  /api/admin/warehouse         — latest export run + cursors + staging counts
 * POST /api/admin/warehouse/export  — run an incremental export batch now
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import {
  runWarehouseExport,
  getLatestExportRun,
  getExportCursors,
  getStagingRecordCount,
} from "../services/warehouseExportService";

export const warehouseAdminRouter = Router();

warehouseAdminRouter.get(
  "/warehouse",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      res.json({
        latest: await getLatestExportRun(),
        cursors: await getExportCursors(),
        stagingRecords: await getStagingRecordCount(),
      });
    } catch (e) {
      next(e);
    }
  }
);

const exportSchema = z.object({
  batchSize: z.number().int().positive().max(5000).optional(),
});

warehouseAdminRouter.post(
  "/warehouse/export",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = exportSchema.parse(req.body ?? {});
      const run = await runWarehouseExport({ batchSize: body.batchSize });
      res.json({
        run,
        cursors: await getExportCursors(),
        stagingRecords: await getStagingRecordCount(),
      });
    } catch (e) {
      next(e);
    }
  }
);
