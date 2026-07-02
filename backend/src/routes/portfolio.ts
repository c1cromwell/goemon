/**
 * Holder portfolio / investment-management tools (Phase 29 P3).
 *
 *   GET /api/portfolio                 → positions (holdings valued) + totals
 *   GET /api/portfolio/distributions   → dividends/yield received
 *   GET /api/portfolio/tax-summary?year=YYYY → informational per-year distribution summary
 *
 * Read-only projections over the ledger. requireAuth; the holder is the caller.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { getPortfolio } from "../services/marketplaceService";
import { getDistributions, getTaxSummary } from "../services/portfolioService";

export const portfolioRouter = Router();

portfolioRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getPortfolio(req.userId!));
  } catch (e) {
    next(e);
  }
});

portfolioRouter.get("/distributions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = z.coerce.number().int().positive().max(500).optional().parse(req.query.limit);
    res.json({ distributions: await getDistributions(req.userId!, limit ?? 100) });
  } catch (e) {
    next(e);
  }
});

portfolioRouter.get("/tax-summary", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = z.coerce.number().int().min(2000).max(2100).optional().parse(req.query.year) ?? new Date().getUTCFullYear();
    res.json(await getTaxSummary(req.userId!, year));
  } catch (e) {
    next(e);
  }
});
