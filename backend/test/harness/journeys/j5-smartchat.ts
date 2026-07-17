/**
 * J5 — SmartChat NL → 90s operation token → transfer, with >$500 MFA gate + idempotent replay.
 *
 * Live HTTP against a running backend (npm run seed:e2e && npm run dev).
 */

import { v4 as uuidv4 } from "uuid";
import { HarnessHttpError } from "../client";
import { clientFrom, fail, note, pass, redactSecret } from "../setup";
import type { JourneyDef, StepContext, StepResult } from "../types";

const RECIPIENT = process.env.HARNESS_RECIPIENT_EMAIL ?? "blair@demo.com";

interface OperationTokenView {
  id: string;
  operation: string;
  status: string;
  mfaRequired: boolean;
  expiresAt: string;
  createdAt: string;
  result: { amount_minor?: string; journalId?: string; currency?: string } | null;
  metadata: Record<string, unknown>;
}

interface SmartChatResult {
  reply: string;
  intent: { operation: string; amountMinor?: string | null; recipient?: string | null };
  operationToken: OperationTokenView | null;
  requiresMfa: boolean;
  devMfaCode?: string;
}

function step(
  id: string,
  label: string,
  run: (ctx: StepContext) => Promise<StepResult>
) {
  return { id, label, run };
}

async function cashMinor(ctx: StepContext): Promise<bigint> {
  const http = clientFrom(ctx);
  const bal = await http.get<{ cash: { amount: string } }>("/api/accounts/balance", ctx.bearer);
  return BigInt(bal.cash.amount);
}

function ttlSecs(token: OperationTokenView): number {
  const exp = new Date(token.expiresAt).getTime();
  const created = new Date(token.createdAt).getTime();
  return Math.round((exp - created) / 1000);
}

export const j5Journey: JourneyDef = {
  id: "j5",
  name: "SmartChat NL → MFA → transfer",
  description:
    "NL transfer → 90s operation token → execute; replay idempotent; >$500 MFA gate + confirm",
  steps: [
    step("auth", "Password login (funded Tier-2 demo)", async (ctx) => {
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
        note(ctx, `POST /api/auth/login/password → userId=${login.userId}`);
        const cash = await cashMinor(ctx);
        ctx.state.cashBefore = cash.toString();
        note(ctx, `GET /api/accounts/balance → cash_minor=${cash.toString()}`);
        if (cash < 70_000n) {
          return fail(
            "auth",
            "Password login (funded Tier-2 demo)",
            `insufficient cash ${cash} minor (need ≥ $700 for $10 + $600 transfers)`
          );
        }
        return pass("auth", "Password login (funded Tier-2 demo)", `userId=${login.userId} cash=${cash}`);
      } catch (e) {
        if (e instanceof HarnessHttpError) {
          return fail(
            "auth",
            "Password login (funded Tier-2 demo)",
            `${e.code}: ${e.message}`,
            e.code
          );
        }
        throw e;
      }
    }),

    step("small_nl", "Small transfer NL → token TTL ≤ 90s (no MFA)", async (ctx) => {
      const http = clientFrom(ctx);
      const message = `send $10 to ${RECIPIENT}`;
      const res = await http.post<SmartChatResult>("/api/smartchat", { message }, { bearer: ctx.bearer });
      note(
        ctx,
        `POST /api/smartchat "${message}" → requiresMfa=${res.requiresMfa} status=${res.operationToken?.status} op=${res.intent.operation}`
      );
      if (res.requiresMfa) {
        return fail("small_nl", "Small transfer NL → token TTL ≤ 90s (no MFA)", "unexpected MFA for $10");
      }
      if (res.intent.operation !== "transfer.send") {
        return fail(
          "small_nl",
          "Small transfer NL → token TTL ≤ 90s (no MFA)",
          `expected transfer.send got ${res.intent.operation}`
        );
      }
      const tok = res.operationToken;
      if (!tok || tok.status !== "executed") {
        return fail(
          "small_nl",
          "Small transfer NL → token TTL ≤ 90s (no MFA)",
          `expected executed token, got ${tok?.status ?? "null"}`
        );
      }
      const ttl = ttlSecs(tok);
      if (ttl > 90) {
        return fail(
          "small_nl",
          "Small transfer NL → token TTL ≤ 90s (no MFA)",
          `token TTL ${ttl}s > 90`
        );
      }
      if (res.intent.amountMinor !== "1000") {
        return fail(
          "small_nl",
          "Small transfer NL → token TTL ≤ 90s (no MFA)",
          `amountMinor=${res.intent.amountMinor} (expected 1000 integer minor units)`
        );
      }
      ctx.state.smallToken = tok;
      ctx.state.smallResult = tok.result;
      ctx.state.cashAfterSmall = (await cashMinor(ctx)).toString();
      return pass(
        "small_nl",
        "Small transfer NL → token TTL ≤ 90s (no MFA)",
        `token=${redactSecret(tok.id)} ttl=${ttl}s amount_minor=${tok.result?.amount_minor ?? res.intent.amountMinor}`
      );
    }),

    step("execute_ok", "Execute path posted one journal (integer minor units)", async (ctx) => {
      const tok = ctx.state.smallToken as OperationTokenView | undefined;
      const before = BigInt(String(ctx.state.cashBefore ?? "0"));
      const after = BigInt(String(ctx.state.cashAfterSmall ?? "0"));
      if (!tok?.result) {
        return fail("execute_ok", "Execute path posted one journal (integer minor units)", "missing result");
      }
      const amount = tok.result.amount_minor;
      if (!amount || !/^\d+$/.test(amount)) {
        return fail(
          "execute_ok",
          "Execute path posted one journal (integer minor units)",
          `non-integer amount_minor=${amount}`
        );
      }
      if (after !== before - BigInt(amount)) {
        return fail(
          "execute_ok",
          "Execute path posted one journal (integer minor units)",
          `cash ${before} → ${after}, expected debit ${amount}`
        );
      }
      note(ctx, `ledger debit ok: ${before} → ${after} (amount_minor=${amount})`);
      return pass(
        "execute_ok",
        "Execute path posted one journal (integer minor units)",
        `journalId=${tok.result.journalId ?? "?"} amount_minor=${amount}`
      );
    }),

    step("replay", "Idempotent replay — same token, no second debit", async (ctx) => {
      const tok = ctx.state.smallToken as OperationTokenView | undefined;
      if (!tok) return fail("replay", "Idempotent replay — same token, no second debit", "missing small token");
      const http = clientFrom(ctx);
      const cashBeforeReplay = await cashMinor(ctx);
      const replay = await http.post<{
        result: { amount_minor?: string; journalId?: string };
        operationToken: OperationTokenView;
      }>(
        `/api/smartchat/tokens/${tok.id}/execute`,
        {},
        { bearer: ctx.bearer, idempotencyKey: uuidv4() }
      );
      note(
        ctx,
        `POST /api/smartchat/tokens/:id/execute → status=${replay.operationToken.status} amount_minor=${replay.result?.amount_minor}`
      );
      const cashAfterReplay = await cashMinor(ctx);
      if (cashAfterReplay !== cashBeforeReplay) {
        return fail(
          "replay",
          "Idempotent replay — same token, no second debit",
          `cash changed on replay: ${cashBeforeReplay} → ${cashAfterReplay}`
        );
      }
      if (replay.operationToken.status !== "executed") {
        return fail(
          "replay",
          "Idempotent replay — same token, no second debit",
          `status=${replay.operationToken.status}`
        );
      }
      if (replay.result?.amount_minor !== "1000") {
        return fail(
          "replay",
          "Idempotent replay — same token, no second debit",
          `unexpected result amount_minor=${replay.result?.amount_minor}`
        );
      }
      return pass(
        "replay",
        "Idempotent replay — same token, no second debit",
        `cash unchanged at ${cashAfterReplay}`
      );
    }),

    step("mfa_gate", "Large transfer NL → MFA required (no debit yet)", async (ctx) => {
      const http = clientFrom(ctx);
      const cashBefore = await cashMinor(ctx);
      ctx.state.cashBeforeMfa = cashBefore.toString();
      const message = `send $600 to ${RECIPIENT}`;
      const res = await http.post<SmartChatResult>("/api/smartchat", { message }, { bearer: ctx.bearer });
      note(
        ctx,
        `POST /api/smartchat "${message}" → requiresMfa=${res.requiresMfa} status=${res.operationToken?.status}`
      );
      if (!res.requiresMfa || res.operationToken?.status !== "awaiting_mfa") {
        return fail(
          "mfa_gate",
          "Large transfer NL → MFA required (no debit yet)",
          `expected awaiting_mfa, got requiresMfa=${res.requiresMfa} status=${res.operationToken?.status}`
        );
      }
      if (!res.devMfaCode) {
        return fail(
          "mfa_gate",
          "Large transfer NL → MFA required (no debit yet)",
          "devMfaCode missing (non-prod should surface the code)"
        );
      }
      const mid = await cashMinor(ctx);
      if (mid !== cashBefore) {
        return fail(
          "mfa_gate",
          "Large transfer NL → MFA required (no debit yet)",
          `money moved before MFA: ${cashBefore} → ${mid}`
        );
      }
      ctx.state.mfaToken = res.operationToken;
      ctx.state.devMfaCode = res.devMfaCode;
      return pass(
        "mfa_gate",
        "Large transfer NL → MFA required (no debit yet)",
        `token=${redactSecret(res.operationToken.id)} (MFA-gated path)`
      );
    }),

    step("mfa_confirm", "Submit MFA → transfer executes once", async (ctx) => {
      const tok = ctx.state.mfaToken as OperationTokenView | undefined;
      const code = ctx.state.devMfaCode as string | undefined;
      if (!tok || !code) {
        return fail("mfa_confirm", "Submit MFA → transfer executes once", "missing MFA token/code");
      }
      const http = clientFrom(ctx);
      const res = await http.post<SmartChatResult>(
        `/api/smartchat/tokens/${tok.id}/mfa`,
        { code },
        { bearer: ctx.bearer, idempotencyKey: uuidv4() }
      );
      note(
        ctx,
        `POST /api/smartchat/tokens/:id/mfa → requiresMfa=${res.requiresMfa} status=${res.operationToken?.status}`
      );
      if (res.requiresMfa || res.operationToken?.status !== "executed") {
        return fail(
          "mfa_confirm",
          "Submit MFA → transfer executes once",
          `expected executed, got status=${res.operationToken?.status}`
        );
      }
      const before = BigInt(String(ctx.state.cashBeforeMfa ?? "0"));
      const after = await cashMinor(ctx);
      if (after !== before - 60_000n) {
        return fail(
          "mfa_confirm",
          "Submit MFA → transfer executes once",
          `cash ${before} → ${after}, expected debit 60000`
        );
      }
      // Replay execute — must not double-debit
      const cashBeforeReplay = after;
      await http.post(
        `/api/smartchat/tokens/${tok.id}/execute`,
        {},
        { bearer: ctx.bearer, idempotencyKey: uuidv4() }
      );
      const cashAfterReplay = await cashMinor(ctx);
      if (cashAfterReplay !== cashBeforeReplay) {
        return fail(
          "mfa_confirm",
          "Submit MFA → transfer executes once",
          `second debit on execute replay: ${cashBeforeReplay} → ${cashAfterReplay}`
        );
      }
      return pass(
        "mfa_confirm",
        "Submit MFA → transfer executes once",
        `debited 60000 minor; execute replay cash unchanged (MFA path closed)`
      );
    }),
  ],
};
