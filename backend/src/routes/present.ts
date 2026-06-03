/**
 * Phase 7 — Presentation routes (external agent → scoped token).
 *
 * POST /api/present/challenge  — a registered client requests a single-use nonce,
 *                                binding the scope it intends to request.
 * POST /api/present            — the wallet posts a signed Verifiable Presentation;
 *                                on success a 90s scoped token is returned.
 *
 * These are called by external parties (the agent / wallet), not by a user
 * session, so there is no requireAuth here — trust is established entirely by the
 * VP signature + nonce + grant checks in presentationService.
 */

import { Router } from "express";
import { z } from "zod";
import { issueNonce, verifyPresentation } from "../services/presentationService";
import { getClientIp } from "../middleware/auth";
import { vpVerifyTotal } from "../observability/metrics";

export const presentRouter = Router();

presentRouter.post("/challenge", async (req, res, next) => {
  try {
    const { clientDid, scope } = z
      .object({ clientDid: z.string().min(1), scope: z.array(z.string()).default([]) })
      .parse(req.body);
    const challenge = await issueNonce(clientDid, scope);
    res.json(challenge);
  } catch (e) {
    next(e);
  }
});

presentRouter.post("/", async (req, res, next) => {
  try {
    const { vpJwt } = z.object({ vpJwt: z.string().min(1) }).parse(req.body);
    const result = await verifyPresentation({ vpJwt, ipAddress: getClientIp(req) });
    vpVerifyTotal.inc({ result: "success" });
    res.json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      scope: result.scope,
      jti: result.jti,
    });
  } catch (e) {
    vpVerifyTotal.inc({ result: "rejected" });
    next(e);
  }
});
