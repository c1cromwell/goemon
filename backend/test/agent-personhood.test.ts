/**
 * Feature A — Agent-Personhood Attestation.
 *
 * "Proving personhood when software agents move money" (the report's flagged frontier):
 *   - a grant by a KYC-verified human mints an attestation → the scoped token carries
 *     personhood: "verified_human";
 *   - a grant made before KYC yields personhood: "unverified" (claim surfaced, not blocked);
 *   - with AGENT_PERSONHOOD_ENFORCED on, an approval-required client is DENIED a token
 *     without a valid attestation (PERSONHOOD_REQUIRED), but a verified human still passes;
 *   - revoking the grant revokes the attestation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, decodeJwt, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config } from "../src/config";
import { publicJwkToDidKey } from "../src/utils/didKey";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-personhood-${Date.now()}.db`;

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

interface Wallet { walletDid: string; privateKey: KeyLike; }
async function makeWallet(): Promise<Wallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { walletDid: publicJwkToDidKey(await exportJWK(publicKey)), privateKey };
}

const FULL_OPS = ["balance:read", "transfer:low", "statement:read", "profile:read"];
let seq = 0;

async function newUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const u = await createUser(`personhood-${seq++}-${Date.now()}@test.com`, "P User");
  return u.id;
}

async function kyc(userId: string, wallet: Wallet): Promise<string> {
  const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
  await issueCredential(userId, 2, FULL_OPS, "PASSED");
  await bindWalletDid(userId, wallet.walletDid);
  return (await getCredential(userId))!.vc_jwt!;
}

async function registerClient(): Promise<string> {
  const { registerClient } = await import("../src/services/mcpClientRegistry");
  const clientDid = `did:simulator:agent-${uuidv4()}`;
  // requireUserApproval defaults to true on registration.
  await registerClient({ clientDid, displayName: "Test Agent", allowedFunctions: FULL_OPS, maxTransferMinor: 50000n });
  return clientDid;
}

async function grant(userId: string, agentDid: string) {
  const { grantAgent } = await import("../src/services/userAgentGrantService");
  await grantAgent({ userId, agentDid, displayName: "Test Agent", allowedFunctions: FULL_OPS, maxTransferMinor: 50000n });
}

async function present(wallet: Wallet, vcJwt: string, clientDid: string) {
  const { issueNonce, verifyPresentation } = await import("../src/services/presentationService");
  const nonce = (await issueNonce(clientDid, ["balance:read", "transfer:low"])).nonce;
  const vp = await new SignJWT({
    nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: wallet.walletDid,
      verifiableCredential: [vcJwt],
    },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(wallet.walletDid)
    .setAudience(config.BASE_URL)
    .setJti(uuidv4())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(wallet.privateKey);
  return verifyPresentation({ vpJwt: vp });
}

describe("Feature A: agent-personhood attestation", () => {
  it("mints a verified_human attestation for a KYC'd granter and stamps the scoped token", async () => {
    const userId = await newUser();
    const wallet = await makeWallet();
    const vcJwt = await kyc(userId, wallet); // KYC first
    const clientDid = await registerClient();
    await grant(userId, clientDid); // grant by a verified human → attestation minted

    const { getActiveAttestation } = await import("../src/services/agentPersonhoodService");
    expect(await getActiveAttestation(userId, clientDid)).toBeTruthy();

    const result = await present(wallet, vcJwt, clientDid);
    expect(result.personhood).toBe("verified_human");
    expect((decodeJwt(result.accessToken) as { personhood?: string }).personhood).toBe("verified_human");
  });

  it("surfaces personhood=unverified when the grant predates KYC (claim, not a block)", async () => {
    const userId = await newUser();
    const wallet = await makeWallet();
    const clientDid = await registerClient();
    await grant(userId, clientDid); // granted BEFORE any credential → no attestation
    const vcJwt = await kyc(userId, wallet); // KYC afterwards (VP needs a bound credential)

    const { getActiveAttestation } = await import("../src/services/agentPersonhoodService");
    expect(await getActiveAttestation(userId, clientDid)).toBeNull();

    const result = await present(wallet, vcJwt, clientDid);
    expect(result.personhood).toBe("unverified"); // surfaced, still minted a token
    expect(result.accessToken).toBeTruthy();
  });

  it("enforces personhood when AGENT_PERSONHOOD_ENFORCED and the client requires approval", async () => {
    const prev = config.AGENT_PERSONHOOD_ENFORCED;
    (config as { AGENT_PERSONHOOD_ENFORCED: boolean }).AGENT_PERSONHOOD_ENFORCED = true;
    try {
      // Unverified (grant-before-KYC) → denied.
      const u1 = await newUser();
      const w1 = await makeWallet();
      const c1 = await registerClient();
      await grant(u1, c1);
      const vc1 = await kyc(u1, w1);
      await expect(present(w1, vc1, c1)).rejects.toMatchObject({ code: ErrorCode.PERSONHOOD_REQUIRED });

      // Verified human → still passes even with enforcement on.
      const u2 = await newUser();
      const w2 = await makeWallet();
      const vc2 = await kyc(u2, w2);
      const c2 = await registerClient();
      await grant(u2, c2);
      const ok = await present(w2, vc2, c2);
      expect(ok.personhood).toBe("verified_human");
    } finally {
      (config as { AGENT_PERSONHOOD_ENFORCED: boolean }).AGENT_PERSONHOOD_ENFORCED = prev;
    }
  });

  it("revokes the attestation when the grant is revoked", async () => {
    const userId = await newUser();
    const wallet = await makeWallet();
    await kyc(userId, wallet);
    const clientDid = await registerClient();
    await grant(userId, clientDid);

    const { getActiveAttestation, personhoodLevelFor } = await import("../src/services/agentPersonhoodService");
    const { revokeGrant } = await import("../src/services/userAgentGrantService");
    expect(await getActiveAttestation(userId, clientDid)).toBeTruthy();

    await revokeGrant(userId, clientDid);
    expect(await getActiveAttestation(userId, clientDid)).toBeNull();
    expect(await personhoodLevelFor(userId, clientDid)).toBe("unverified");
  });
});
