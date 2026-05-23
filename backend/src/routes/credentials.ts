/**
 * Phase 2 — Credential routes.
 *
 * POST /api/credentials/issue         — issue a VC for the authenticated user
 * POST /api/credentials/:id/revoke    — revoke own credential
 * GET  /api/credentials/me            — get own credential (JWT + metadata)
 * GET  /api/credentials/status/:year  — BitstringStatusList VC JWT (public)
 *
 * The /issue endpoint does a mock KYC pass for Phase 2 (no real IDV yet).
 * Phase 3 will call issueCredential() from the real KYC completion handler
 * instead of from this explicit endpoint.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as vcService from "../services/vcService";
import * as statusListService from "../services/statusListService";
import { getActiveKey, issuerDid } from "../services/didService";
import { SignJWT } from "jose";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export const credentialsRouter = Router();

// POST /api/credentials/issue
// Body: { tier?: number, allowedOps?: string[] }
credentialsRouter.post("/issue", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        tier: z.number().int().min(0).max(4).default(2),
        allowedOps: z.array(z.string()).optional(),
      })
      .parse(req.body);

    const jwt = await vcService.issueCredential(
      req.userId!,
      body.tier,
      body.allowedOps ?? [...vcService.DEFAULT_ALLOWED_OPS]
    );

    res.status(201).json({ jwt });
  } catch (e) {
    next(e);
  }
});

// POST /api/credentials/:credentialId/revoke
// Body: { reason?: string }
credentialsRouter.post("/:credentialId/revoke", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { reason = "user_requested" } = z
      .object({ reason: z.string().max(200).optional() })
      .parse(req.body);

    await vcService.revokeCredential(req.params.credentialId!, req.userId!, reason);
    res.json({ revoked: true });
  } catch (e) {
    next(e);
  }
});

// GET /api/credentials/me
credentialsRouter.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const row = await vcService.getCredential(req.userId!);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "No credential found");

    res.json({
      id: row.id,
      jwt: row.vc_jwt,
      didSubject: row.did_subject,
      allowedOps: JSON.parse(row.allowed_ops),
      revoked: row.revoked === 1,
      revokeReason: row.revoke_reason,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/credentials/status/:year  — public; returns a signed BitstringStatusList VC JWT
credentialsRouter.get("/status/:year", async (req, res, next) => {
  try {
    const year = z.coerce.number().int().min(2024).max(2100).parse(req.params.year);
    const encodedList = await statusListService.getEncodedList(year);
    const { kid, privateKey } = getActiveKey();

    const listUrl = `${config.CREDENTIAL_BASE_URL}/api/credentials/status/${year}`;
    const now = Math.floor(Date.now() / 1000);

    const listVcPayload = {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/vc/status-list/2021/v1",
      ],
      id: listUrl,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: `${issuerDid}#${kid}`,
      validFrom: new Date(now * 1000).toISOString(),
      credentialSubject: {
        id: `${listUrl}#list`,
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList,
      },
    };

    const jwt = await new SignJWT({ vc: listVcPayload })
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(`${issuerDid}#${kid}`)
      .setIssuedAt(now)
      .sign(privateKey);

    res.json({ year, jwt, statusListCredential: listVcPayload });
  } catch (e) {
    next(e);
  }
});
