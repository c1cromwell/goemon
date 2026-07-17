/**
 * Shared setup helpers for harness journeys (login, VC, bind, grant).
 * Env: HARNESS_DEMO_EMAIL / HARNESS_DEMO_PASSWORD (defaults = seeded demo user).
 */

import { createClient, HarnessHttpError, type HarnessClient } from "./client";
import { createWalletSim, type WalletSim } from "./walletSim";
import type { StepContext } from "./types";

export const CLIENT_DID = "did:simulator:agent-app";

/** Scopes matching the seeded simulator MCP client (first-run-setup). */
export const DEFAULT_SCOPES = [
  "balance:read",
  "statement:read",
  "profile:read",
  "transfer:low",
] as const;

export function demoEmail(): string {
  return process.env.HARNESS_DEMO_EMAIL ?? "alex@demo.com";
}

export function demoPassword(): string {
  return process.env.HARNESS_DEMO_PASSWORD ?? "Demo1234!";
}

export function clientFrom(ctx: StepContext): HarnessClient {
  return createClient(ctx.baseUrl);
}

/** Redact JWTs / tokens for artifact trails — never log private key material. */
export function redactSecret(value: string | undefined | null): string {
  if (!value) return "(empty)";
  if (value.length <= 16) return `[redacted len=${value.length}]`;
  return `[redacted ${value.slice(0, 6)}…${value.slice(-4)} len=${value.length}]`;
}

export function note(ctx: StepContext, line: string): void {
  const trail = (ctx.state.transcript as string[] | undefined) ?? [];
  trail.push(line);
  ctx.state.transcript = trail;
}

export interface LinkedAccount {
  email: string;
  userId: string;
  sessionToken: string;
  vcJwt: string;
  wallet: WalletSim;
  scopes: string[];
}

/**
 * One-time linking: password login → ensure VC → bind wallet → grant simulator agent.
 * Mirrors goemon-agent `linkAccount` against the live HTTP API.
 */
export async function linkDemoAccount(ctx: StepContext): Promise<LinkedAccount> {
  const http = clientFrom(ctx);
  const email = demoEmail();
  const password = demoPassword();
  const scopes = [...DEFAULT_SCOPES];

  const login = await http.post<{ userId: string; token: string }>("/api/auth/login/password", {
    email,
    password,
  });
  note(ctx, `POST /api/auth/login/password → 200 userId=${login.userId}`);
  ctx.bearer = login.token;

  let vcJwt: string;
  try {
    const me = await http.get<{ jwt: string }>("/api/credentials/me", login.token);
    vcJwt = me.jwt;
    note(ctx, `GET /api/credentials/me → existing VC ${redactSecret(vcJwt)}`);
  } catch (e) {
    if (!(e instanceof HarnessHttpError) || e.status !== 404) throw e;
    const issued = await http.post<{ jwt: string }>("/api/credentials/issue", {}, { bearer: login.token });
    vcJwt = issued.jwt;
    note(ctx, `POST /api/credentials/issue → VC ${redactSecret(vcJwt)}`);
  }

  const wallet = await createWalletSim();
  await http.post<{ bound: boolean }>(
    "/api/credentials/bind-wallet",
    { walletDid: wallet.walletDid },
    { bearer: login.token }
  );
  note(ctx, `POST /api/credentials/bind-wallet → ${wallet.walletDid}`);

  await http.post(
    "/api/my-agents",
    {
      agentDid: CLIENT_DID,
      displayName: "Harness simulator agent",
      allowedFunctions: scopes,
      maxTransferMinor: "50000",
      currency: "USD",
    },
    { bearer: login.token }
  );
  note(ctx, `POST /api/my-agents → grant ${CLIENT_DID} scopes=[${scopes.join(",")}]`);

  const linked: LinkedAccount = {
    email,
    userId: login.userId,
    sessionToken: login.token,
    vcJwt,
    wallet,
    scopes,
  };
  ctx.state.linked = linked;
  return linked;
}

export function requireLinked(ctx: StepContext): LinkedAccount {
  const linked = ctx.state.linked as LinkedAccount | undefined;
  if (!linked) throw new Error("Journey state missing linked account — run setup steps first");
  return linked;
}

export async function challenge(
  ctx: StepContext,
  scope: string[]
): Promise<{ nonce: string; aud: string; scope: string[]; expiresAt: string }> {
  const http = clientFrom(ctx);
  const ch = await http.post<{ nonce: string; aud: string; scope: string[]; expiresAt: string }>(
    "/api/present/challenge",
    { clientDid: CLIENT_DID, scope }
  );
  note(ctx, `POST /api/present/challenge → nonce=${redactSecret(ch.nonce)} aud=${ch.aud}`);
  return ch;
}

export function pass(id: string, label: string, detail?: string, errorCode?: string) {
  return { id, label, status: "PASS" as const, detail, errorCode };
}

export function fail(id: string, label: string, detail: string, errorCode?: string) {
  return { id, label, status: "FAIL" as const, detail, errorCode };
}
