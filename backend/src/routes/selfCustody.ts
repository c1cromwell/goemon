/**
 * X-Money response F2 — self-custody & portability routes (the anti-deplatforming proof).
 *
 * GET /api/self-custody/report       — self-custodied vs custodial breakdown + the guarantee
 * GET /api/self-custody/attestation  — the report as an issuer-signed, JWKS-verifiable JWT
 * GET /api/self-custody/export       — the portable "right to exit" manifest (signed)
 *
 * Read-only, no money movement (Phase-A safe). Always available — self-custody is not
 * a feature you toggle; it's the architecture.
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { getSelfCustodyReport, getSignedAttestation, getExportManifest } from "../services/selfCustodyService";

export const selfCustodyRouter = Router();

selfCustodyRouter.get("/report", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getSelfCustodyReport(req.userId!));
  } catch (e) {
    next(e);
  }
});

selfCustodyRouter.get("/attestation", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getSignedAttestation(req.userId!));
  } catch (e) {
    next(e);
  }
});

selfCustodyRouter.get("/export", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getExportManifest(req.userId!));
  } catch (e) {
    next(e);
  }
});
