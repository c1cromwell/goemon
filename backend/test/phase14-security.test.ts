/**
 * Phase 14 — final security-invariant verification.
 *
 * Coverage map for the Phase 14 invariants (a–p):
 *   a,b,c (money/ledger/idempotency)     → test/invariants.test.ts
 *   d,e,f,g (VP sig / grant / scope / replay / nonce / 90s) → test/presentation.test.ts
 *   h  VC revocation is immediate         → HERE
 *   i  user-denial unblocks immediately   → N/A: this backend's /api/present is
 *      synchronous (no pending_tokens/__DENIED__ relay); see Phase 11 notes.
 *   j  password auth impossible in prod   → HERE (productionFatals)
 *   k  5 failed attempts → lockout        → HERE
 *   l  admin routes require a role        → HERE (requireRole)
 *   m  server never holds user Hedera key → KNOWN GAP: Phase 5 stores
 *      private_key_hex server-side (KMS/on-device signing deferred; documented).
 *   n  daily on-chain↔ledger reconciliation → not implemented (deferred).
 *   o,p iOS (Keychain/Secure Enclave/deep links) → BankAIWallet (unverified source).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config, productionFatals } from "../src/config";
import { publicJwkToDidKey } from "../src/utils/didKey";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-phase14-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";

  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

// --- VP helpers (mirror presentation.test.ts) ------------------------------
interface Wallet { walletDid: string; privateKey: KeyLike; }
async function makeWallet(): Promise<Wallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { walletDid: publicJwkToDidKey(await exportJWK(publicKey)), privateKey };
}
let seq = 0;
async function setupUser(ops: string[]) {
  const { createUser } = await import("../src/services/authService");
  const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
  const u = await createUser(`p14-${seq++}-${Date.now()}@test.com`, "P14 User");
  await issueCredential(u.id, 2, ops, "PASSED");
  const wallet = await makeWallet();
  await bindWalletDid(u.id, wallet.walletDid);
  const cred = (await getCredential(u.id))!;
  return { userId: u.id, wallet, vcJwt: cred.vc_jwt!, credentialId: cred.id };
}
async function buildVp(wallet: Wallet, vcJwt: string, nonce: string): Promise<string> {
  return new SignJWT({
    nonce,
    vp: { "@context": ["https://www.w3.org/2018/credentials/v1"], type: ["VerifiablePresentation"], holder: wallet.walletDid, verifiableCredential: [vcJwt] },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(wallet.walletDid).setAudience(config.BASE_URL).setJti(uuidv4()).setIssuedAt().setExpirationTime("5m")
    .sign(wallet.privateKey);
}
const OPS = ["balance:read", "transfer:low", "statement:read", "profile:read"];
async function registerClient() {
  const { registerClient } = await import("../src/services/mcpClientRegistry");
  const clientDid = `did:simulator:agent-${uuidv4()}`;
  await registerClient({ clientDid, displayName: "P14", allowedFunctions: OPS, maxTransferMinor: 50000n });
  return clientDid;
}
async function grant(userId: string, agentDid: string) {
  const { grantAgent } = await import("../src/services/userAgentGrantService");
  await grantAgent({ userId, agentDid, displayName: "P14", allowedFunctions: OPS, maxTransferMinor: 50000n });
}

// --- h. VC revocation is immediate -----------------------------------------
describe("h. VC revocation is immediate", () => {
  it("rejects a presentation once the credential is revoked (CREDENTIAL_REVOKED)", async () => {
    const { verifyPresentation, issueNonce } = await import("../src/services/presentationService");
    const { revokeCredential } = await import("../src/services/vcService");
    const user = await setupUser(OPS);
    const clientDid = await registerClient();
    await grant(user.userId, clientDid);

    // Sanity: a valid VP works before revocation.
    const ok = await verifyPresentation({ vpJwt: await buildVp(user.wallet, user.vcJwt, (await issueNonce(clientDid, OPS)).nonce) });
    expect(ok.accessToken).toBeTruthy();

    // Revoke, then present again → rejected immediately.
    await revokeCredential(user.credentialId, user.userId, "test");
    const nonce2 = (await issueNonce(clientDid, OPS)).nonce;
    await expect(
      verifyPresentation({ vpJwt: await buildVp(user.wallet, user.vcJwt, nonce2) })
    ).rejects.toMatchObject({ code: ErrorCode.CREDENTIAL_REVOKED });
  });
});

// --- k. 5 failed auth attempts → lockout -----------------------------------
describe("k. auth lockout", () => {
  it("blocks further attempts after AUTH_MAX_FAILURES within the window", async () => {
    const { recordAuthFailure, authLimiter } = await import("../src/middleware/rateLimit");
    const email = `lockme-${Date.now()}@test.com`;
    const ip = "203.0.113.55";
    for (let i = 0; i < config.AUTH_MAX_FAILURES; i++) await recordAuthFailure(email, ip);

    const req = { body: { email }, ip, socket: { remoteAddress: ip } } as never;
    const err = await new Promise<unknown>((resolve) => {
      authLimiter()(req, {} as never, (e?: unknown) => resolve(e));
    });
    expect(err).toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED });
  });
});

// --- l. admin routes require a role ----------------------------------------
describe("l. requireRole", () => {
  it("denies a role not in the allowlist and admits one that is", async () => {
    const { requireRole } = await import("../src/middleware/rbac");
    const mw = requireRole("compliance", "admin");

    const denied = await new Promise<unknown>((resolve) =>
      mw({ adminRole: "support" } as never, {} as never, (e?: unknown) => resolve(e))
    );
    expect(denied).toMatchObject({ code: ErrorCode.FORBIDDEN });

    const noRole = await new Promise<unknown>((resolve) =>
      mw({} as never, {} as never, (e?: unknown) => resolve(e))
    );
    expect(noRole).toMatchObject({ code: ErrorCode.UNAUTHENTICATED });

    const allowed = await new Promise<unknown>((resolve) =>
      mw({ adminRole: "admin" } as never, {} as never, (e?: unknown) => resolve(e))
    );
    expect(allowed).toBeUndefined(); // next() with no error
  });
});

// --- j. password auth impossible in production -----------------------------
describe("j. production refuses password auth", () => {
  it("productionFatals flags ALLOW_PASSWORD_AUTH=true in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(48),
      ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false,
      HEDERA_ENABLED: false,
      ONBOARDING_ORCHESTRATOR: "simulated",
      SMARTCHAT_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "",
      HEDERA_OPERATOR_ID: "",
      HEDERA_OPERATOR_KEY: "",
    } as unknown as Parameters<typeof productionFatals>[0];

    expect(productionFatals(base)).toEqual([]); // a clean prod config
    const withPassword = { ...base, ALLOW_PASSWORD_AUTH: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(withPassword).some((f) => f.includes("ALLOW_PASSWORD_AUTH"))).toBe(true);
  });
});
