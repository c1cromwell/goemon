/**
 * Phase 7 — User-facing agent grant management.
 *
 * GET  /api/my-agents                    — list the user's grants
 * POST /api/my-agents                    — grant (or re-grant) an agent
 * POST /api/my-agents/:agentDid/revoke   — revoke a grant
 *
 * A grant is the user's explicit consent for an external agent to act on their
 * behalf, bounded by allowed functions and a per-transfer ceiling. Without an
 * active grant, presentationService denies the agent (GRANT_MISSING) even with a
 * valid Verifiable Presentation.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError, ErrorCode } from "../errors";
import { grantAgent, listGrants, revokeGrant } from "../services/userAgentGrantService";

/** Parse a minor-unit amount (integer string/number) into a non-negative bigint. */
function toMinorBigInt(v: string | number): bigint {
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "maxTransferMinor must be an integer (minor units)");
  }
  if (n < 0n) throw new AppError(ErrorCode.VALIDATION, "maxTransferMinor must be >= 0");
  return n;
}

export const myAgentsRouter = Router();

myAgentsRouter.get("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const grants = await listGrants(req.userId!);
    res.json({
      grants: grants.map((g) => ({
        agentDid: g.agentDid,
        displayName: g.displayName,
        description: g.description,
        allowedFunctions: g.allowedFunctions,
        maxTransferMinor: g.maxTransferMinor.toString(),
        currency: g.currency,
        active: g.active,
        grantedAt: g.grantedAt,
        lastUsedAt: g.lastUsedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

myAgentsRouter.post("/", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        agentDid: z.string().min(1),
        displayName: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        allowedFunctions: z.array(z.string()).min(1),
        maxTransferMinor: z.union([z.string(), z.number()]),
        currency: z.enum(["USD", "USDC"]).default("USD"),
      })
      .parse(req.body);

    const grant = await grantAgent({
      userId: req.userId!,
      agentDid: body.agentDid,
      displayName: body.displayName,
      description: body.description,
      allowedFunctions: body.allowedFunctions,
      maxTransferMinor: toMinorBigInt(body.maxTransferMinor),
      currency: body.currency,
    });
    res.status(201).json({
      agentDid: grant.agentDid,
      allowedFunctions: grant.allowedFunctions,
      maxTransferMinor: grant.maxTransferMinor.toString(),
      active: grant.active,
    });
  } catch (e) {
    next(e);
  }
});

myAgentsRouter.post("/:agentDid/revoke", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { reason = "user_requested" } = z.object({ reason: z.string().max(200).optional() }).parse(req.body);
    await revokeGrant(req.userId!, req.params.agentDid!, reason);
    res.json({ revoked: true });
  } catch (e) {
    next(e);
  }
});
