/**
 * Phase 24.1 — x401 HTTP proof routes.
 */

import { Router } from "express";
import { z } from "zod";
import { getClientIp } from "../middleware/auth";
import { vpVerifyTotal } from "../observability/metrics";
import {
  X401_HEADER_PRESENTATION,
  X401_HEADER_REQUIRED,
  X401_HEADER_RESPONSE,
  X401_VERIFICATION_TOKEN_HEADER,
  issueProofRequirement,
  redeemVerificationToken,
  verifyProofPresentation,
} from "../services/x401Service";

export const x401Router = Router();

x401Router.post("/challenge", async (req, res, next) => {
  try {
    const { clientDid, scope } = z
      .object({ clientDid: z.string().min(1), scope: z.array(z.string()).default(["balance:read"]) })
      .parse(req.body);
    const result = await issueProofRequirement(clientDid, scope);
    res.setHeader(X401_HEADER_REQUIRED, result.header);
    res.json({ challenge: result.challenge, requirement: result.payload });
  } catch (e) {
    next(e);
  }
});

x401Router.post("/present", async (req, res, next) => {
  try {
    const header =
      (req.header(X401_HEADER_PRESENTATION) as string | undefined) ??
      (req.body?.presentationHeader as string | undefined);
    if (!header) {
      res.status(400).json({ error: { code: "VALIDATION", message: "PROOF-PRESENTATION header required", retryable: false } });
      return;
    }
    let result;
    try {
      result = await verifyProofPresentation({ presentationHeader: header, ipAddress: getClientIp(req) });
      vpVerifyTotal.inc({ result: "success" });
    } catch (e) {
      vpVerifyTotal.inc({ result: "rejected" });
      throw e;
    }
    res.setHeader(X401_VERIFICATION_TOKEN_HEADER, result.verification.token);
    res.json({
      access_token: result.scoped.accessToken,
      token_type: result.scoped.tokenType,
      expires_in: result.scoped.expiresIn,
      scope: result.scoped.scope,
      verification_token: result.verification.token,
      verification_expires_in: result.verification.expiresIn,
    });
  } catch (e) {
    next(e);
  }
});

x401Router.post("/token/redeem", async (req, res, next) => {
  try {
    const token =
      (req.header(X401_VERIFICATION_TOKEN_HEADER) as string | undefined) ??
      z.object({ token: z.string().min(1) }).parse(req.body).token;
    const redeemed = await redeemVerificationToken(token);
    res.json(redeemed);
  } catch (e) {
    next(e);
  }
});

/** Demo protected resource — returns PROOF-REQUIRED when unauthenticated. */
x401Router.get("/demo/resource", async (req, res, next) => {
  try {
    const token = req.header(X401_VERIFICATION_TOKEN_HEADER);
    if (!token) {
      const { clientDid, scope } = z
        .object({ clientDid: z.string().min(1), scope: z.array(z.string()).default(["balance:read"]) })
        .parse({ clientDid: req.query.clientDid ?? "did:simulator:agent-app", scope: ["balance:read"] });
      const result = await issueProofRequirement(clientDid, scope, 120);
      res.setHeader(X401_HEADER_REQUIRED, result.header);
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Proof required — present PROOF-PRESENTATION", retryable: true },
        requirement: result.payload,
      });
      return;
    }
    const redeemed = await redeemVerificationToken(token);
    res.json({ ok: true, userId: redeemed.userId, scope: redeemed.scope, resource: "x401-demo-content" });
  } catch (e) {
    if (e instanceof Error && "code" in e) {
      res.setHeader(X401_HEADER_RESPONSE, Buffer.from(JSON.stringify({ ok: false, code: (e as { code?: string }).code }), "utf8").toString("base64url"));
    }
    next(e);
  }
});
