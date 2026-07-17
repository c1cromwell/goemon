/**
 * J6 — External agent: OID4VP → VP verified → MCP scoped op (security-critical).
 *
 * Live HTTP client against a running backend (npm run seed:e2e && npm run dev).
 */

import { v4 as uuidv4 } from "uuid";
import { HarnessHttpError } from "../client";
import {
  CLIENT_DID,
  challenge,
  clientFrom,
  fail,
  linkDemoAccount,
  note,
  pass,
  redactSecret,
  requireLinked,
} from "../setup";
import { createWalletSim, signPresentation } from "../walletSim";
import type { JourneyDef, StepContext, StepResult } from "../types";

async function expectCode(
  fn: () => Promise<unknown>,
  code: string
): Promise<{ ok: true } | { ok: false; got: string; message: string }> {
  try {
    await fn();
    return { ok: false, got: "(success)", message: `expected ${code} but call succeeded` };
  } catch (e) {
    if (e instanceof HarnessHttpError) {
      if (e.code === code) return { ok: true };
      return { ok: false, got: e.code, message: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, got: "ERROR", message: msg };
  }
}

function step(
  id: string,
  label: string,
  run: (ctx: StepContext) => Promise<StepResult>
) {
  return { id, label, run };
}

export const j6Journey: JourneyDef = {
  id: "j6",
  name: "OID4VP → VP verify → MCP",
  description:
    "Challenge → wallet-signed VP → 90s scoped token → MCP; asserts VP_INVALID, REPLAY_DETECTED, SCOPE_DENIED",
  steps: [
    step("health", "GET /api/health", async (ctx) => {
      const http = clientFrom(ctx);
      const h = await http.get<{ status: string }>("/api/health");
      note(ctx, `GET /api/health → ${JSON.stringify(h)}`);
      if (h.status !== "ok") return fail("health", "GET /api/health", `unexpected status ${h.status}`);
      return pass("health", "GET /api/health", "status=ok");
    }),

    step("auth", "Password login (demo user)", async (ctx) => {
      // linkDemoAccount does login + VC + bind + grant; we split for the step trail.
      // Auth-only first so the trail matches the plan's ordered steps.
      const http = clientFrom(ctx);
      const email = process.env.HARNESS_DEMO_EMAIL ?? "alex@demo.com";
      const password = process.env.HARNESS_DEMO_PASSWORD ?? "Demo1234!";
      try {
        const login = await http.post<{ userId: string; token: string }>("/api/auth/login/password", {
          email,
          password,
        });
        ctx.bearer = login.token;
        ctx.state.userId = login.userId;
        ctx.state.email = email;
        note(ctx, `POST /api/auth/login/password → userId=${login.userId}`);
        return pass("auth", "Password login (demo user)", `userId=${login.userId}`);
      } catch (e) {
        if (e instanceof HarnessHttpError) {
          return fail(
            "auth",
            "Password login (demo user)",
            `${e.code}: ${e.message} (is ALLOW_PASSWORD_AUTH enabled and seed:e2e run?)`,
            e.code
          );
        }
        throw e;
      }
    }),

    step("issue_vc", "Issue / load VC", async (ctx) => {
      const http = clientFrom(ctx);
      const token = ctx.bearer;
      if (!token) return fail("issue_vc", "Issue / load VC", "missing session bearer");
      try {
        let vcJwt: string;
        try {
          vcJwt = (await http.get<{ jwt: string }>("/api/credentials/me", token)).jwt;
          note(ctx, `GET /api/credentials/me → ${redactSecret(vcJwt)}`);
        } catch (e) {
          if (!(e instanceof HarnessHttpError) || e.status !== 404) throw e;
          vcJwt = (await http.post<{ jwt: string }>("/api/credentials/issue", {}, { bearer: token })).jwt;
          note(ctx, `POST /api/credentials/issue → ${redactSecret(vcJwt)}`);
        }
        ctx.state.vcJwt = vcJwt;
        return pass("issue_vc", "Issue / load VC", redactSecret(vcJwt));
      } catch (e) {
        if (e instanceof HarnessHttpError) {
          return fail("issue_vc", "Issue / load VC", `${e.code}: ${e.message}`, e.code);
        }
        throw e;
      }
    }),

    step("bind_wallet", "Bind wallet did:key", async (ctx) => {
      const http = clientFrom(ctx);
      const token = ctx.bearer;
      const vcJwt = ctx.state.vcJwt as string | undefined;
      if (!token || !vcJwt) return fail("bind_wallet", "Bind wallet did:key", "missing session or VC");
      const wallet = await createWalletSim();
      await http.post("/api/credentials/bind-wallet", { walletDid: wallet.walletDid }, { bearer: token });
      note(ctx, `POST /api/credentials/bind-wallet → ${wallet.walletDid}`);
      ctx.state.wallet = wallet;
      // Stash linked-shaped state for later helpers
      ctx.state.linked = {
        email: ctx.state.email,
        userId: ctx.state.userId,
        sessionToken: token,
        vcJwt,
        wallet,
        scopes: ["balance:read", "statement:read", "profile:read", "transfer:low"],
      };
      return pass("bind_wallet", "Bind wallet did:key", wallet.walletDid);
    }),

    step("grant", "Grant simulator agent", async (ctx) => {
      const http = clientFrom(ctx);
      const token = ctx.bearer;
      if (!token) return fail("grant", "Grant simulator agent", "missing session bearer");
      const scopes = ["balance:read", "statement:read", "profile:read", "transfer:low"];
      await http.post(
        "/api/my-agents",
        {
          agentDid: CLIENT_DID,
          displayName: "Harness simulator agent",
          allowedFunctions: scopes,
          maxTransferMinor: "50000",
          currency: "USD",
        },
        { bearer: token }
      );
      note(ctx, `POST /api/my-agents → ${CLIENT_DID}`);
      return pass("grant", "Grant simulator agent", `client=${CLIENT_DID}`);
    }),

    step("challenge", "OID4VP challenge (happy-path scopes)", async (ctx) => {
      const ch = await challenge(ctx, ["balance:read", "transfer:low"]);
      ctx.state.challenge = ch;
      return pass("challenge", "OID4VP challenge (happy-path scopes)", `nonce=${redactSecret(ch.nonce)}`);
    }),

    step("present_ok", "Present VP → scoped token (TTL ≤ 90s)", async (ctx) => {
      const linked = requireLinked(ctx);
      const ch = ctx.state.challenge as { nonce: string; aud: string };
      const http = clientFrom(ctx);
      const vpJwt = await signPresentation(linked.wallet, {
        nonce: ch.nonce,
        vcJwt: linked.vcJwt,
        aud: ch.aud,
      });
      note(ctx, `signed VP ${redactSecret(vpJwt)}`);
      const token = await http.post<{
        access_token: string;
        expires_in: number;
        scope: string[];
        jti: string;
      }>("/api/present", { vpJwt });
      note(
        ctx,
        `POST /api/present → expires_in=${token.expires_in} scope=[${token.scope.join(",")}] jti=${redactSecret(token.jti)}`
      );
      if (token.expires_in > 90) {
        return fail(
          "present_ok",
          "Present VP → scoped token (TTL ≤ 90s)",
          `expires_in=${token.expires_in} > 90`
        );
      }
      ctx.state.scopedToken = token;
      // Keep a copy of this VP for documentation only — replay uses a fresh nonce below.
      ctx.state.lastVpJwt = vpJwt;
      return pass(
        "present_ok",
        "Present VP → scoped token (TTL ≤ 90s)",
        `expires_in=${token.expires_in} scope=[${token.scope.join(",")}]`
      );
    }),

    step("mcp_balance", "MCP get_balance within scope", async (ctx) => {
      const token = ctx.state.scopedToken as { access_token: string } | undefined;
      if (!token) return fail("mcp_balance", "MCP get_balance within scope", "missing scoped token");
      const http = clientFrom(ctx);
      const callId = uuidv4();
      const res = await http.post<{ ok: boolean; tool: string; result: unknown }>(
        "/mcp/call",
        { tool: "get_balance", args: {}, callId },
        { bearer: token.access_token }
      );
      note(ctx, `POST /mcp/call get_balance → ok=${res.ok}`);
      if (!res.ok) return fail("mcp_balance", "MCP get_balance within scope", "ok=false");
      return pass("mcp_balance", "MCP get_balance within scope", `tool=${res.tool}`);
    }),

    step("wrong_key", "VP signed by wrong key → VP_INVALID", async (ctx) => {
      const linked = requireLinked(ctx);
      const ch = await challenge(ctx, ["balance:read"]);
      const attacker = await createWalletSim();
      const vpJwt = await signPresentation(linked.wallet, {
        nonce: ch.nonce,
        vcJwt: linked.vcJwt,
        aud: ch.aud,
        signKey: attacker.privateKey,
      });
      const http = clientFrom(ctx);
      const r = await expectCode(() => http.post("/api/present", { vpJwt }), "VP_INVALID");
      note(ctx, `POST /api/present (wrong key) → ${r.ok ? "VP_INVALID" : `got ${"got" in r ? r.got : "?"}`}`);
      if (!r.ok) {
        return fail(
          "wrong_key",
          "VP signed by wrong key → VP_INVALID",
          `expected VP_INVALID got ${r.got}: ${r.message}`,
          r.got
        );
      }
      return pass("wrong_key", "VP signed by wrong key → VP_INVALID", undefined, "VP_INVALID");
    }),

    step("replay", "Replayed VP → REPLAY_DETECTED", async (ctx) => {
      const linked = requireLinked(ctx);
      const ch = await challenge(ctx, ["balance:read"]);
      const http = clientFrom(ctx);
      const vpJwt = await signPresentation(linked.wallet, {
        nonce: ch.nonce,
        vcJwt: linked.vcJwt,
        aud: ch.aud,
      });
      await http.post("/api/present", { vpJwt });
      note(ctx, "POST /api/present (replay setup) → first use ok");
      const r = await expectCode(() => http.post("/api/present", { vpJwt }), "REPLAY_DETECTED");
      note(ctx, `POST /api/present (replay) → ${r.ok ? "REPLAY_DETECTED" : `got ${"got" in r ? r.got : "?"}`}`);
      if (!r.ok) {
        return fail(
          "replay",
          "Replayed VP → REPLAY_DETECTED",
          `expected REPLAY_DETECTED got ${r.got}: ${r.message}`,
          r.got
        );
      }
      return pass("replay", "Replayed VP → REPLAY_DETECTED", undefined, "REPLAY_DETECTED");
    }),

    step("scope_deny", "MCP tool outside scope → SCOPE_DENIED", async (ctx) => {
      const linked = requireLinked(ctx);
      // Token with only balance:read — pay_merchant requires pay:merchant.
      const ch = await challenge(ctx, ["balance:read"]);
      const http = clientFrom(ctx);
      const vpJwt = await signPresentation(linked.wallet, {
        nonce: ch.nonce,
        vcJwt: linked.vcJwt,
        aud: ch.aud,
      });
      const token = await http.post<{ access_token: string }>("/api/present", { vpJwt });
      const r = await expectCode(
        () =>
          http.post(
            "/mcp/call",
            {
              tool: "pay_merchant",
              args: { intentId: "00000000-0000-0000-0000-000000000000" },
              callId: uuidv4(),
            },
            { bearer: token.access_token }
          ),
        "SCOPE_DENIED"
      );
      note(ctx, `POST /mcp/call pay_merchant → ${r.ok ? "SCOPE_DENIED" : `got ${"got" in r ? r.got : "?"}`}`);
      if (!r.ok) {
        return fail(
          "scope_deny",
          "MCP tool outside scope → SCOPE_DENIED",
          `expected SCOPE_DENIED got ${r.got}: ${r.message}`,
          r.got
        );
      }
      return pass("scope_deny", "MCP tool outside scope → SCOPE_DENIED", undefined, "SCOPE_DENIED");
    }),
  ],
};

/** Optional: full link helper for other journeys. */
export { linkDemoAccount };
