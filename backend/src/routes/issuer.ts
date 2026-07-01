/**
 * Issuer / issuance console (Phase 29 P1).
 *
 *   GET  /api/issuer/options                         → asset types + compliance profiles (pickers)
 *   POST /api/issuer/assets   (Idempotency-Key)      → create a compliant token (+ optional listing)
 *   GET  /api/issuer/assets                          → the caller's issued tokens
 *
 * Gated by ISSUANCE_CONSOLE_ENABLED via the service. The issuer is the authenticated
 * user. No new money path — orchestrates createAsset + the listing lifecycle.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { issuanceOptions, issueAsset, listIssuedAssets } from "../services/issuanceService";

export const issuerRouter = Router();

function bigintStr(field: string) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    try {
      const n = BigInt(v);
      if (n < 0n) throw new Error();
      return n;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be a non-negative integer` });
      return z.NEVER;
    }
  });
}

const bodySchema = z.object({
  kind: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().max(16).optional(),
  decimals: z.coerce.number().int().min(0).max(18).optional(),
  complianceProfile: z.string().optional(),
  minTier: z.coerce.number().int().min(0).max(4).optional(),
  jurisdictionAllow: z.array(z.string().trim().min(1)).optional(),
  holderCap: z.coerce.number().int().positive().optional(),
  whitelist: z.array(z.string().trim().min(1)).optional(),
  metadata: z.record(z.unknown()).optional(),
  custodyAttestationUri: z.string().trim().url().optional(),
  initialSupply: bigintStr("initialSupply"),
  listing: z
    .object({
      surface: z.enum(["invest", "collect"]),
      priceMinor: bigintStr("priceMinor"),
      priceSource: z.string().optional(),
      currency: z.string().optional(),
    })
    .optional(),
});

issuerRouter.get("/options", requireAuth, (_req: AuthRequest, res: Response) => {
  res.json(issuanceOptions());
});

issuerRouter.post("/assets", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = bodySchema.parse(req.body);
    const result = await issueAsset({ issuerUserId: req.userId!, ...body });
    res.status(201).json({
      asset: {
        id: result.asset.id,
        kind: result.asset.kind,
        name: result.asset.name,
        symbol: result.asset.symbol,
        tokenStandard: result.asset.tokenStandard,
        isSecurity: result.asset.isSecurity,
        totalSupply: result.asset.totalSupply.toString(),
      },
      listed: result.listed,
      complianceProfile: result.complianceProfile,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

issuerRouter.get("/assets", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const assets = await listIssuedAssets(req.userId!);
    res.json({
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        symbol: a.symbol,
        tokenStandard: a.tokenStandard,
        isSecurity: a.isSecurity,
        totalSupply: a.totalSupply.toString(),
        status: a.status,
      })),
    });
  } catch (e) {
    next(e);
  }
});
