/**
 * Agent orchestrator (mcpClient) — runs one intent through the full OID4VP path:
 *
 *   challenge(clientDid, scope)  → one-time nonce
 *   wallet signs a VP binding the VC to that nonce   (Face ID in the real wallet)
 *   present(vp)                  → 90s scoped token   (or denial: GRANT_MISSING…)
 *   mcp/call(tool, args, callId) with the scoped token → result
 *
 * Emits a step trace so the UI can show the token countdown and tool-call log.
 */
import { present, mcp, ApiError } from "./api";
import { signPresentation } from "./wallet";
import type { Intent } from "./intent";

export const CLIENT_DID = "did:simulator:agent-app";

export interface ScopedToken {
  accessToken: string;
  expiresIn: number;
  scope: string[];
  jti: string;
  obtainedAt: number;
}

export type StepStatus = "ok" | "denied" | "error";
export interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface AgentRun {
  reply: string;
  steps: Step[];
  token?: ScopedToken;
  toolCall?: { tool: string; args: Record<string, unknown>; result: unknown };
}

export async function runIntent(intent: Intent, vcJwt: string): Promise<AgentRun> {
  const steps: Step[] = [];
  if (intent.kind === "chat" || !intent.tool || !intent.scope) {
    return { reply: replyForChat(intent), steps };
  }

  // 1. Challenge
  let challenge;
  try {
    challenge = await present.challenge(CLIENT_DID, [intent.scope]);
    steps.push({ label: "Challenge issued", status: "ok", detail: `scope ${intent.scope}` });
  } catch (e) {
    steps.push({ label: "Challenge", status: "error", detail: msg(e) });
    return { reply: `I couldn't start a request: ${msg(e)}`, steps };
  }

  // 2. Wallet signs the VP (the Face-ID moment in the real wallet)
  let vpJwt: string;
  try {
    vpJwt = await signPresentation({ nonce: challenge.nonce, vcJwt, aud: challenge.aud });
    steps.push({ label: "Wallet signed presentation", status: "ok" });
  } catch (e) {
    steps.push({ label: "Wallet signature", status: "error", detail: msg(e) });
    return { reply: `The wallet couldn't sign the request: ${msg(e)}`, steps };
  }

  // 3. Present → scoped token
  let token: ScopedToken;
  try {
    const t = await present.submit(vpJwt);
    token = { accessToken: t.access_token, expiresIn: t.expires_in, scope: t.scope, jti: t.jti, obtainedAt: Date.now() };
    steps.push({ label: "Scoped token minted", status: "ok", detail: `${t.expires_in}s · [${t.scope.join(", ")}]` });
  } catch (e) {
    const denied = e instanceof ApiError;
    steps.push({ label: "Presentation", status: denied ? "denied" : "error", detail: msg(e) });
    return { reply: denialReply(e), steps };
  }

  // 4. MCP tool call
  try {
    const res = await mcp.call(token.accessToken, { tool: intent.tool, args: intent.args ?? {}, callId: crypto.randomUUID() });
    steps.push({ label: `Called ${intent.tool}`, status: "ok" });
    return {
      reply: formatResult(intent.tool, res.result),
      steps,
      token,
      toolCall: { tool: intent.tool, args: intent.args ?? {}, result: res.result },
    };
  } catch (e) {
    steps.push({ label: `Call ${intent.tool}`, status: e instanceof ApiError ? "denied" : "error", detail: msg(e) });
    return { reply: denialReply(e), steps, token };
  }
}

// --- helpers ---------------------------------------------------------------

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "error";
}

function denialReply(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "GRANT_MISSING":
        return "Access was denied — you haven't granted this agent (or the grant was revoked).";
      case "SCOPE_DENIED":
        return `Denied: ${e.message}`;
      case "VP_INVALID":
        return "The presentation signature was rejected.";
      default:
        return `Denied: ${e.message}`;
    }
  }
  return `Something went wrong: ${msg(e)}`;
}

function replyForChat(intent: Intent): string {
  if (intent.summary.startsWith("Transfer")) {
    return "To send money, tell me an amount and a recipient email — e.g. “send $20 to alex@demo.com”.";
  }
  return "I can check your balance, list recent transactions, read your profile, or send money. What would you like?";
}

function fmtUsd(minor: string | number): string {
  return `$${(Number(minor) / 100).toFixed(2)}`;
}

function formatResult(tool: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  switch (tool) {
    case "get_balance":
      return `Your balance is ${fmtUsd(String(r.cashMinor))} available${
        Number(r.savingsMinor) > 0 ? ` and ${fmtUsd(String(r.savingsMinor))} in savings` : ""
      }.`;
    case "get_profile":
      return `You're Tier ${r.tier} (${r.status}), risk ${r.riskTier}.`;
    case "get_transactions": {
      const txns = (r.transactions as Array<{ amountMinor: string; currency: string; description: string }>) ?? [];
      if (txns.length === 0) return "No recent transactions.";
      const lines = txns.slice(0, 5).map((t) => `• ${t.description || "transfer"} — ${fmtUsd(t.amountMinor)}`);
      return `Your recent transactions:\n${lines.join("\n")}`;
    }
    case "transfer_funds":
      return `Done — sent ${fmtUsd(String(r.amountMinor))}. Journal ${String(r.journalId).slice(0, 8)}.`;
    default:
      return JSON.stringify(result);
  }
}
