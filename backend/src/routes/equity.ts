/**
 * Employee equity compensation (Phase 29 P4).
 *
 *   POST /api/equity/grants                 → create a grant (caller = grantor)
 *   GET  /api/equity/grants                 → my grants (caller = recipient), with vesting
 *   GET  /api/equity/grants/:id             → one grant (recipient or grantor)
 *   POST /api/equity/grants/:id/release     → deliver newly-vested units (award/profits-interest)
 *   POST /api/equity/grants/:id/exercise    → exercise vested options (Idempotency-Key)
 *   POST /api/equity/grants/:id/file-83b    → mark the 83(b) election filed
 *   GET  /api/equity/captable/:assetId      → issuer cap-table view
 *
 * Gated by EQUITY_COMP_ENABLED via the service. Ties to docs/legal/EQUITY-INCENTIVE-PLAN.md.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import {
  createGrant, getGrant, listGrantsForRecipient, releaseVested, exercise, mark83bFiled,
  capTable, computeVested, type EquityGrant,
} from "../services/equityCompService";
import { getAsset } from "../services/tokenizationService";

export const equityRouter = Router();

function bigintStr(field: string) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    try { const n = BigInt(v); if (n < 0n) throw new Error(); return n; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be a non-negative integer` }); return z.NEVER; }
  });
}

/** Serialize a grant for the recipient view, with vesting computed at request time. */
function view(g: EquityGrant) {
  const vested = computeVested(g);
  return {
    id: g.id, assetId: g.assetId, awardType: g.awardType,
    unitsTotal: g.unitsTotal.toString(), unitsReleased: g.unitsReleased.toString(),
    vested: vested.toString(),
    releasable: g.awardType === "option" ? "0" : (vested - g.unitsReleased).toString(),
    exercisable: g.awardType === "option" ? (vested - g.unitsReleased).toString() : "0",
    exercisePriceMinor: g.exercisePriceMinor.toString(), thresholdMinor: g.thresholdMinor.toString(),
    currency: g.currency, vestStart: g.vestStart, cliffMonths: g.cliffMonths, durationMonths: g.durationMonths,
    eightyThreeBFiled: g.eightyThreeBFiled, eightyThreeBDeadline: g.eightyThreeBDeadline, status: g.status,
  };
}

const createSchema = z.object({
  assetId: z.string().min(1),
  recipientUserId: z.string().min(1),
  awardType: z.enum(["unit_award", "profits_interest", "option"]),
  unitsTotal: bigintStr("unitsTotal"),
  exercisePriceMinor: bigintStr("exercisePriceMinor").optional(),
  thresholdMinor: bigintStr("thresholdMinor").optional(),
  currency: z.string().optional(),
  vestStart: z.string().optional(),
  cliffMonths: z.coerce.number().int().min(0).max(120).optional(),
  durationMonths: z.coerce.number().int().min(1).max(240).optional(),
});

equityRouter.post("/grants", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const grant = await createGrant({ grantorUserId: req.userId!, ...body });
    res.status(201).json(view(grant));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

equityRouter.get("/grants", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const grants = await listGrantsForRecipient(req.userId!);
    const enriched = await Promise.all(grants.map(async (g) => {
      const a = await getAsset(g.assetId);
      return { ...view(g), assetName: a?.name ?? null, assetSymbol: a?.symbol ?? null };
    }));
    res.json({ grants: enriched });
  } catch (e) { next(e); }
});

async function loadOwned(id: string, userId: string): Promise<EquityGrant> {
  const g = await getGrant(id);
  if (g.recipientUserId !== userId && g.grantorUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your grant");
  return g;
}

equityRouter.get("/grants/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(view(await loadOwned(req.params.id!, req.userId!))); } catch (e) { next(e); }
});

equityRouter.post("/grants/:id/release", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const g = await loadOwned(req.params.id!, req.userId!);
    res.json(view(await releaseVested(g.id)));
  } catch (e) { next(e); }
});

equityRouter.post("/grants/:id/exercise", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const g = await getGrant(req.params.id!);
    if (g.recipientUserId !== req.userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your grant");
    const { qty } = z.object({ qty: bigintStr("qty") }).parse(req.body);
    const key = (req.header("Idempotency-Key") ?? `${g.id}:${Date.now()}`).slice(0, 120);
    res.json(view(await exercise({ grantId: g.id, qty, idempotencyKey: key })));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

equityRouter.post("/grants/:id/file-83b", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const g = await getGrant(req.params.id!);
    if (g.recipientUserId !== req.userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your grant");
    res.json(view(await mark83bFiled(g.id)));
  } catch (e) { next(e); }
});

equityRouter.get("/captable/:assetId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await capTable(req.params.assetId!)); } catch (e) { next(e); }
});
