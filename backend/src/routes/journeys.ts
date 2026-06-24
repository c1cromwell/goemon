/**
 * Journey orchestration routes (prototype) — drive a declarative journey as a client.
 *
 * POST /api/journeys/:journeyId/start     — begin a run (returns the first SDUI screen or outcome)
 * POST /api/journeys/runs/:runId/submit   — submit the current screen's input, resume
 * POST /api/journeys/runs/:runId/review   — resolve a manual-review pause (RBAC in prod)
 * GET  /api/journeys/runs/:runId          — current run state
 *
 * Decision-only: gated by JOURNEYS_ENABLED. Trust is the session; the runner never
 * moves money.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { startJourney, submitStep, resolveReview, getRun } from "../journeys/journeyRunner";

export const journeysRouter = Router();

function assertEnabled(): void {
  if (!config.JOURNEYS_ENABLED) throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Journey orchestration is not enabled on this server");
}

journeysRouter.post("/:journeyId/start", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertEnabled();
    const body = z.object({ data: z.record(z.unknown()).optional() }).parse(req.body ?? {});
    res.json(await startJourney(req.params.journeyId!, { subjectUserId: req.userId!, data: body.data as Record<string, never> }));
  } catch (e) {
    next(e);
  }
});

journeysRouter.post("/runs/:runId/submit", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertEnabled();
    const body = z.object({ input: z.record(z.unknown()).default({}) }).parse(req.body ?? {});
    res.json(await submitStep(req.params.runId!, body.input as Record<string, never>));
  } catch (e) {
    next(e);
  }
});

journeysRouter.post("/runs/:runId/review", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertEnabled();
    const body = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() }).parse(req.body);
    res.json(await resolveReview(req.params.runId!, body.decision, body.reason));
  } catch (e) {
    next(e);
  }
});

journeysRouter.get("/runs/:runId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    assertEnabled();
    res.json(await getRun(req.params.runId!));
  } catch (e) {
    next(e);
  }
});
