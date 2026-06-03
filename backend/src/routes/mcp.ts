/**
 * Phase 7 — MCP server endpoint (external agent tool execution).
 *
 * An agent that holds a 90s scoped token (from POST /api/present) calls tools
 * here. Every call:
 *   - re-verifies the scoped token (RS256, our key),
 *   - re-binds it to the originating presentation (token jti → vp_presentations),
 *   - enforces the tool's required scope against the token's effective scope,
 *   - for transfers, enforces integer-minor-unit amount <= client AND grant ceiling,
 *     executing via transferService with idempotency key = tokenJti + callId,
 *   - records an append-only mcp_audit_logs row (success/denied/error).
 *
 * GET  /mcp/tools  — public tool catalog (name, description, required scope).
 * POST /mcp/call   — { tool, args, callId } with Authorization: Bearer <scoped token>.
 */

import { Router, type Request } from "express";
import { z } from "zod";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { verifyToken } from "../utils/tokenFactory";
import { getClientIp } from "../middleware/auth";
import { recordMcpAudit } from "../services/presentationService";
import { agentRateLimit } from "../middleware/rateLimit";
import { mcpCallTotal } from "../observability/metrics";
import { getClient } from "../services/mcpClientRegistry";
import { getActiveGrant } from "../services/userAgentGrantService";
import { transfer, getTransactionHistory } from "../services/transferService";
import { getUserBalances } from "../services/ledgerService";
import { getProfile } from "../services/identityService";

export const mcpRouter = Router();

interface ToolDef {
  name: string;
  description: string;
  requiredScope: string;
}

const TOOLS: ToolDef[] = [
  { name: "get_balance", description: "Read the user's cash and savings balances.", requiredScope: "balance:read" },
  { name: "get_transactions", description: "List the user's recent transactions.", requiredScope: "statement:read" },
  { name: "get_profile", description: "Read the user's identity tier and status.", requiredScope: "profile:read" },
  { name: "transfer_funds", description: "Transfer funds to another BankAI user.", requiredScope: "transfer:low" },
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

interface ScopedContext {
  userId: string;
  clientDid: string;
  scope: string[];
  jti: string;
}

/** Verify the Bearer scoped token and re-bind it to its originating presentation. */
async function authScopedToken(req: Request): Promise<ScopedContext> {
  const auth = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) throw new AppError(ErrorCode.UNAUTHENTICATED, "Missing bearer token");

  let payload;
  try {
    ({ payload } = await verifyToken(match[1]!));
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired token");
  }
  const jti = payload.jti;
  const clientDid = payload.act?.sub;
  const scope = payload.scope ?? [];
  if (!jti || !clientDid) throw new AppError(ErrorCode.UNAUTHENTICATED, "Not a scoped agent token");

  // Bind the token back to the presentation that minted it (authoritative user id).
  const pres = await getDb().queryOne<{ user_id: string; client_did: string }>(
    "SELECT user_id, client_did FROM vp_presentations WHERE token_jti = ?",
    [jti]
  );
  if (!pres || pres.client_did !== clientDid) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Token not bound to a presentation");
  }
  return { userId: pres.user_id, clientDid, scope, jti };
}

mcpRouter.get("/tools", (_req, res) => {
  res.json({ tools: TOOLS });
});

mcpRouter.post("/call", async (req, res, next) => {
  const started = Date.now();
  let ctx: ScopedContext | null = null;
  let toolName = "";
  try {
    const body = z
      .object({ tool: z.string().min(1), args: z.record(z.unknown()).default({}), callId: z.string().min(1) })
      .parse(req.body);
    toolName = body.tool;
    ctx = await authScopedToken(req);
    // Per-agent-DID rate limit (after auth — the DID is only known here).
    agentRateLimit(ctx.clientDid);
    const ip = getClientIp(req);

    const tool = TOOL_BY_NAME.get(body.tool);
    if (!tool) throw new AppError(ErrorCode.NOT_FOUND, `Unknown tool: ${body.tool}`);

    // Scope enforcement: the tool's required scope must be in the token's effective scope.
    if (!ctx.scope.includes(tool.requiredScope)) {
      await recordMcpAudit({
        userId: ctx.userId,
        agentDid: ctx.clientDid,
        toolName: body.tool,
        scopeUsed: ctx.scope,
        args: body.args,
        resultStatus: "denied",
        errorMessage: `missing scope ${tool.requiredScope}`,
        tokenJti: ctx.jti,
        ipAddress: ip,
        durationMs: Date.now() - started,
      });
      mcpCallTotal.inc({ tool: body.tool, result: "denied" });
      throw new AppError(ErrorCode.SCOPE_DENIED, `Tool ${body.tool} requires scope ${tool.requiredScope}`);
    }

    const result = await executeTool(tool, ctx, body.args, body.callId);

    await recordMcpAudit({
      userId: ctx.userId,
      agentDid: ctx.clientDid,
      toolName: body.tool,
      scopeUsed: [tool.requiredScope],
      args: body.args,
      resultStatus: "success",
      tokenJti: ctx.jti,
      ipAddress: ip,
      durationMs: Date.now() - started,
    });
    mcpCallTotal.inc({ tool: body.tool, result: "success" });
    res.json({ ok: true, tool: body.tool, result });
  } catch (e) {
    // Record execution errors (scope-denied already recorded above).
    if (ctx && !(e instanceof AppError && e.code === ErrorCode.SCOPE_DENIED)) {
      await recordMcpAudit({
        userId: ctx.userId,
        agentDid: ctx.clientDid,
        toolName,
        scopeUsed: ctx.scope,
        resultStatus: "error",
        errorMessage: e instanceof Error ? e.message : "error",
        tokenJti: ctx.jti,
        ipAddress: getClientIp(req),
        durationMs: Date.now() - started,
      }).catch(() => undefined);
      mcpCallTotal.inc({ tool: toolName || "unknown", result: "error" });
    }
    next(e);
  }
});

// ---------------------------------------------------------------------------

async function executeTool(
  tool: ToolDef,
  ctx: ScopedContext,
  args: Record<string, unknown>,
  callId: string
): Promise<unknown> {
  switch (tool.name) {
    case "get_balance": {
      const { cash, savings } = await getUserBalances(ctx.userId);
      return { cashMinor: cash.toString(), savingsMinor: savings.toString(), currency: "USD" };
    }
    case "get_transactions": {
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return { transactions: await getTransactionHistory(ctx.userId, limit) };
    }
    case "get_profile": {
      const profile = await getProfile(ctx.userId);
      if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Profile not found");
      return { tier: profile.tier, status: profile.identity_status, riskTier: profile.risk_tier };
    }
    case "transfer_funds":
      return executeTransfer(ctx, args, callId);
    default:
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `Tool ${tool.name} not implemented`);
  }
}

async function executeTransfer(
  ctx: ScopedContext,
  args: Record<string, unknown>,
  callId: string
): Promise<unknown> {
  const parsed = z
    .object({
      to: z.string().min(1),
      amountMinor: z.union([z.string(), z.number()]),
      currency: z.enum(["USD", "USDC"]).default("USD"),
    })
    .parse(args);

  let amountMinor: bigint;
  try {
    amountMinor = BigInt(parsed.amountMinor);
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "amountMinor must be an integer (minor units)");
  }
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");

  // Enforce BOTH the client ceiling and the user's grant ceiling.
  const client = await getClient(ctx.clientDid);
  const grant = await getActiveGrant(ctx.userId, ctx.clientDid);
  if (!client || !client.active) throw new AppError(ErrorCode.FORBIDDEN, "Client not active");
  if (!grant) throw new AppError(ErrorCode.GRANT_MISSING, "Grant no longer active");
  if (amountMinor > client.maxTransferMinor) {
    throw new AppError(ErrorCode.SCOPE_DENIED, "Amount exceeds client per-transfer limit");
  }
  if (amountMinor > grant.maxTransferMinor) {
    throw new AppError(ErrorCode.SCOPE_DENIED, "Amount exceeds your grant per-transfer limit");
  }

  // Resolve recipient by email or user id.
  const recipient = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM users WHERE email = ? OR id = ?",
    [parsed.to, parsed.to]
  );
  if (!recipient) throw new AppError(ErrorCode.NOT_FOUND, "Recipient not found");

  const result = await transfer({
    fromUserId: ctx.userId,
    toUserId: recipient.id,
    amountMinor,
    currency: parsed.currency,
    description: `Agent transfer via ${ctx.clientDid}`,
    idempotencyKey: `mcp:${ctx.jti}:${callId}`,
  });
  return { journalId: result.journalId, transactionId: result.transactionId, amountMinor: amountMinor.toString() };
}
