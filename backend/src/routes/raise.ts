/**
 * Capital formation / primary raises (Phase 29 P5).
 *
 *   POST /api/raise/offerings                 → open a raise (caller = issuer)
 *   GET  /api/raise/offerings                 → open offerings (+ asset + progress)
 *   GET  /api/raise/offerings/:id             → one offering (+ progress)
 *   POST /api/raise/offerings/:id/invest      → commit funds (Idempotency-Key)
 *   POST /api/raise/offerings/:id/close        → settle or refund (issuer)
 *   POST /api/raise/offerings/:id/cancel       → refund all (issuer)
 *   GET  /api/raise/my-investments            → the caller's commitments
 *
 * Gated by CAPITAL_RAISE_ENABLED via the service.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import {
  openOffering, getOffering, listOpenOfferings, invest, closeOffering, cancelOffering,
  listMyInvestments, offeringProgress, type Offering,
} from "../services/capitalRaiseService";
import { getAsset } from "../services/tokenizationService";

export const raiseRouter = Router();

function bigintStr(field: string) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    try { const n = BigInt(v); if (n < 0n) throw new Error(); return n; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be a non-negative integer` }); return z.NEVER; }
  });
}

async function offeringView(o: Offering) {
  const [asset, progress] = await Promise.all([getAsset(o.assetId), offeringProgress(o.id)]);
  return {
    id: o.id, assetId: o.assetId, issuerUserId: o.issuerUserId, assetName: asset?.name ?? null, assetSymbol: asset?.symbol ?? null,
    exemption: o.exemption, priceMinor: o.priceMinor.toString(), currency: o.currency,
    targetMinor: o.targetMinor.toString(), capMinor: o.capMinor.toString(),
    minInvestmentMinor: o.minInvestmentMinor.toString(),
    maxInvestmentMinor: o.maxInvestmentMinor?.toString() ?? null,
    status: o.status, openedAt: o.openedAt, closesAt: o.closesAt, closedAt: o.closedAt,
    ...progress,
  };
}

const openSchema = z.object({
  assetId: z.string().min(1),
  exemption: z.enum(["reg_cf", "reg_d_506c", "reg_a"]),
  priceMinor: bigintStr("priceMinor"),
  targetMinor: bigintStr("targetMinor"),
  capMinor: bigintStr("capMinor"),
  minInvestmentMinor: bigintStr("minInvestmentMinor").optional(),
  maxInvestmentMinor: bigintStr("maxInvestmentMinor").optional(),
  currency: z.string().optional(),
  closesAt: z.string().optional(),
});

raiseRouter.post("/offerings", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = openSchema.parse(req.body);
    const o = await openOffering({ issuerUserId: req.userId!, ...body });
    res.status(201).json(await offeringView(o));
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

raiseRouter.get("/offerings", requireAuth, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const list = await listOpenOfferings();
    res.json({ offerings: await Promise.all(list.map(offeringView)) });
  } catch (e) { next(e); }
});

raiseRouter.get("/offerings/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await offeringView(await getOffering(req.params.id!))); } catch (e) { next(e); }
});

raiseRouter.post("/offerings/:id/invest", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { units } = z.object({ units: bigintStr("units") }).parse(req.body);
    const key = (req.header("Idempotency-Key") ?? `${req.params.id}:${Date.now()}`).slice(0, 120);
    const inv = await invest({ offeringId: req.params.id!, investorUserId: req.userId!, units, idempotencyKey: key });
    res.status(201).json({ id: inv.id, offeringId: inv.offeringId, units: inv.units.toString(), amountMinor: inv.amountMinor.toString(), status: inv.status });
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

async function requireIssuer(id: string, userId: string): Promise<void> {
  const o = await getOffering(id);
  if (o.issuerUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Only the issuer can manage this offering");
}

raiseRouter.post("/offerings/:id/close", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await requireIssuer(req.params.id!, req.userId!); res.json(await closeOffering(req.params.id!)); } catch (e) { next(e); }
});

raiseRouter.post("/offerings/:id/cancel", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { await requireIssuer(req.params.id!, req.userId!); res.json(await cancelOffering(req.params.id!)); } catch (e) { next(e); }
});

raiseRouter.get("/my-investments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const inv = await listMyInvestments(req.userId!);
    res.json({ investments: inv.map((i) => ({ id: i.id, offeringId: i.offeringId, units: i.units.toString(), amountMinor: i.amountMinor.toString(), status: i.status, createdAt: i.createdAt })) });
  } catch (e) { next(e); }
});
