/**
 * Phase 7 — Verifiable Presentation gate (security-critical) tests.
 *
 * Verifies the non-negotiable invariants of presentationService.verifyPresentation:
 *   1. A VP signed by the WRONG key is REJECTED (VP_INVALID).
 *   2. A replayed VP (same hash) is REJECTED (REPLAY_DETECTED).
 *   3. A reused nonce is REJECTED (NONCE_INVALID).
 *   4. Effective scope = VC ∩ client ∩ requested ∩ grant (drops scopes not in all four).
 *   5. An agent the user never granted is REJECTED even with a valid VP (GRANT_MISSING).
 *   + a happy path that mints a scoped token.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config } from "../src/config";
import { publicJwkToDidKey } from "../src/utils/didKey";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-presentation-${Date.now()}.db`;

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

// --- helpers ---------------------------------------------------------------

interface Wallet {
  walletDid: string;
  privateKey: KeyLike;
}

async function makeWallet(): Promise<Wallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const walletDid = publicJwkToDidKey(await exportJWK(publicKey));
  return { walletDid, privateKey };
}

interface TestUser {
  userId: string;
  wallet: Wallet;
  vcJwt: string;
}

let seq = 0;
async function setupUser(allowedOps: string[]): Promise<TestUser> {
  const { createUser } = await import("../src/services/authService");
  const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
  const email = `agent-user-${seq++}-${Date.now()}@test.com`;
  const u = await createUser(email, "Agent User");
  await issueCredential(u.id, 2, allowedOps, "PASSED");
  const wallet = await makeWallet();
  await bindWalletDid(u.id, wallet.walletDid);
  const cred = await getCredential(u.id);
  return { userId: u.id, wallet, vcJwt: cred!.vc_jwt! };
}

async function buildVp(opts: {
  wallet: Wallet;
  vcJwt: string;
  nonce: string;
  aud?: string;
  signKey?: KeyLike; // override to sign with the WRONG key
  jti?: string; // vary to change the VP hash while keeping the nonce
}): Promise<string> {
  return new SignJWT({
    nonce: opts.nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: opts.wallet.walletDid,
      verifiableCredential: [opts.vcJwt],
    },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(opts.wallet.walletDid)
    .setAudience(opts.aud ?? config.BASE_URL)
    .setJti(opts.jti ?? uuidv4())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(opts.signKey ?? opts.wallet.privateKey);
}

const FULL_OPS = ["balance:read", "transfer:low", "statement:read", "profile:read"];

async function registerClient(allowedFunctions: string[], maxTransferMinor = 50000n) {
  const { registerClient } = await import("../src/services/mcpClientRegistry");
  const clientDid = `did:simulator:agent-${uuidv4()}`;
  await registerClient({ clientDid, displayName: "Test Agent", allowedFunctions, maxTransferMinor });
  return clientDid;
}

async function grant(userId: string, agentDid: string, allowedFunctions: string[]) {
  const { grantAgent } = await import("../src/services/userAgentGrantService");
  await grantAgent({ userId, agentDid, displayName: "Test Agent", allowedFunctions, maxTransferMinor: 50000n });
}

async function issueNonce(clientDid: string, scope: string[]) {
  const { issueNonce } = await import("../src/services/presentationService");
  return (await issueNonce(clientDid, scope)).nonce;
}

// --- tests -----------------------------------------------------------------

describe("Phase 7: happy path", () => {
  it("mints a 90s scoped token for a fully valid presentation", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    const user = await setupUser(FULL_OPS);
    const clientDid = await registerClient(FULL_OPS);
    await grant(user.userId, clientDid, FULL_OPS);
    const nonce = await issueNonce(clientDid, ["balance:read", "transfer:low"]);

    const vp = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce });
    const result = await verifyPresentation({ vpJwt: vp });

    expect(result.expiresIn).toBe(90);
    expect(result.userId).toBe(user.userId);
    expect(result.scope.sort()).toEqual(["balance:read", "transfer:low"]);
    expect(result.accessToken).toBeTruthy();
  });
});

describe("Phase 7: signature verification", () => {
  it("rejects a VP signed by the WRONG key (VP_INVALID)", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    const user = await setupUser(FULL_OPS);
    const clientDid = await registerClient(FULL_OPS);
    await grant(user.userId, clientDid, FULL_OPS);
    const nonce = await issueNonce(clientDid, FULL_OPS);

    const attacker = await makeWallet(); // claims user.wallet's DID but signs with attacker key
    const vp = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce, signKey: attacker.privateKey });

    await expect(verifyPresentation({ vpJwt: vp })).rejects.toMatchObject({ code: ErrorCode.VP_INVALID });
  });
});

describe("Phase 7: replay and nonce", () => {
  it("rejects a replayed VP with the same hash (REPLAY_DETECTED)", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    const user = await setupUser(FULL_OPS);
    const clientDid = await registerClient(FULL_OPS);
    await grant(user.userId, clientDid, FULL_OPS);
    const nonce = await issueNonce(clientDid, FULL_OPS);

    const vp = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce });
    await verifyPresentation({ vpJwt: vp }); // first use succeeds
    await expect(verifyPresentation({ vpJwt: vp })).rejects.toMatchObject({ code: ErrorCode.REPLAY_DETECTED });
  });

  it("rejects reuse of a consumed nonce by a different VP (NONCE_INVALID)", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    const user = await setupUser(FULL_OPS);
    const clientDid = await registerClient(FULL_OPS);
    await grant(user.userId, clientDid, FULL_OPS);
    const nonce = await issueNonce(clientDid, FULL_OPS);

    const vp1 = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce, jti: "vp-1" });
    await verifyPresentation({ vpJwt: vp1 }); // consumes the nonce

    // A genuinely different VP (different hash) reusing the same nonce.
    const vp2 = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce, jti: "vp-2" });
    await expect(verifyPresentation({ vpJwt: vp2 })).rejects.toMatchObject({ code: ErrorCode.NONCE_INVALID });
  });
});

describe("Phase 7: scope intersection", () => {
  it("drops scopes not present in ALL of VC, client, request, and grant", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    // VC: balance, transfer, statement, profile
    const user = await setupUser(["balance:read", "transfer:low", "statement:read", "profile:read"]);
    // client: balance, transfer
    const clientDid = await registerClient(["balance:read", "transfer:low"]);
    // grant: balance, profile
    await grant(user.userId, clientDid, ["balance:read", "profile:read"]);
    // request: balance, statement
    const nonce = await issueNonce(clientDid, ["balance:read", "statement:read"]);

    const vp = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce });
    const result = await verifyPresentation({ vpJwt: vp });
    // Only balance:read is in all four sets.
    expect(result.scope).toEqual(["balance:read"]);
  });
});

describe("Phase 7: grant enforcement", () => {
  it("rejects an agent the user never granted, even with a valid VP (GRANT_MISSING)", async () => {
    const { verifyPresentation } = await import("../src/services/presentationService");
    const user = await setupUser(FULL_OPS);
    const clientDid = await registerClient(FULL_OPS);
    // NO grant created.
    const nonce = await issueNonce(clientDid, FULL_OPS);

    const vp = await buildVp({ wallet: user.wallet, vcJwt: user.vcJwt, nonce });
    await expect(verifyPresentation({ vpJwt: vp })).rejects.toMatchObject({ code: ErrorCode.GRANT_MISSING });
  });
});
