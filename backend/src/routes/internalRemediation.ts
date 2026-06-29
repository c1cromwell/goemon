/**
 * Phase 20 — internal remediation API. The standalone fraud engine calls these
 * endpoints (service-bearer auth, NOT user sessions) to act on an async decision:
 * freeze/unfreeze an account or flag a transaction. Goeman owns the deterministic
 * money state; the engine merely requests it. All calls are idempotent on
 * `decisionId`, so a retried callback is a no-op.
 *
 * Mounted at /api/internal/remediation.
 */

import { Router, type Request, type Response } from "express";
import { requireServiceAuth } from "../middleware/serviceAuth";
import { placeHold, releaseHold, flagTransaction } from "../services/accountHoldService";
import { ErrorCode } from "../errors";

export const internalRemediationRouter = Router();

internalRemediationRouter.use(requireServiceAuth);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

internalRemediationRouter.post("/freeze", async (req: Request, res: Response) => {
  const userId = str(req.body?.userId);
  if (!userId) {
    res.status(400).json({ error: { code: ErrorCode.VALIDATION, message: "userId required", retryable: false } });
    return;
  }
  const result = await placeHold({
    userId,
    reason: str(req.body?.reason) ?? "fraud engine remediation",
    source: "fraud_engine",
    decisionId: str(req.body?.decisionId),
  });
  res.json({ ok: true, applied: result.applied, frozen: true });
});

internalRemediationRouter.post("/unfreeze", async (req: Request, res: Response) => {
  const userId = str(req.body?.userId);
  if (!userId) {
    res.status(400).json({ error: { code: ErrorCode.VALIDATION, message: "userId required", retryable: false } });
    return;
  }
  const result = await releaseHold({
    userId,
    reason: str(req.body?.reason) ?? "fraud engine clear",
    source: "fraud_engine",
    decisionId: str(req.body?.decisionId),
  });
  res.json({ ok: true, applied: result.applied, frozen: false });
});

internalRemediationRouter.post("/flag-transaction", async (req: Request, res: Response) => {
  const userId = str(req.body?.userId);
  const transactionRef = str(req.body?.transactionRef);
  if (!userId || !transactionRef) {
    res.status(400).json({ error: { code: ErrorCode.VALIDATION, message: "userId and transactionRef required", retryable: false } });
    return;
  }
  await flagTransaction({
    userId,
    transactionRef,
    reason: str(req.body?.reason) ?? "fraud engine flag",
    source: "fraud_engine",
    decisionId: str(req.body?.decisionId),
  });
  res.json({ ok: true });
});
