/**
 * X-Money response F2 — self-custody & portability (the anti-deplatforming proof).
 *
 *   1. report: splits self-custodied (wallet did:key — server holds no key) from the
 *      custodial ledger balance (honestly disclosed), with the guarantee statements.
 *   2. the attestation is an issuer-signed, JWKS-verifiable JWT (anyone can verify it).
 *   3. the export manifest is the portable "right to exit" — wallet DID + credential +
 *      on-chain account + holdings, signed and verifiable. No money moves.
 *   4. on-chain branch: a Hedera account surfaces with serverHoldsKey=false (on-device).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { createLocalJWKSet, jwtVerify } from "jose";

const TMP_DB = `./data/test-selfcustody-${Date.now()}.db`;

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
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function setupUser(opts: { wallet?: boolean; hedera?: boolean } = {}): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`sc-${Date.now()}-${Math.random()}@test.com`, "SC");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 custodial ledger balance
  if (opts.wallet) {
    const { issueCredential, bindWalletDid } = await import("../src/services/vcService");
    await issueCredential(u.id, 2, ["balance:read"], "PASSED");
    await bindWalletDid(u.id, "did:key:zDnaeTESTwalletkey123");
  }
  let hederaId = "";
  if (opts.hedera) {
    const { getDb } = await import("../src/db");
    hederaId = `0.0.${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
    await getDb().execute(
      "INSERT INTO hedera_accounts (id, user_id, hedera_account_id, evm_address, public_key) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), u.id, hederaId, "0xabc", "302a300506032b6570032100DEADBEEF"]
    );
  }
  return u.id;
}

describe("Self-custody & portability (F2)", () => {
  it("report splits self-custodied wallet from the (honestly-disclosed) custodial balance", async () => {
    const { getSelfCustodyReport } = await import("../src/services/selfCustodyService");
    const u = await setupUser({ wallet: true });
    const r = await getSelfCustodyReport(u);
    expect(r.selfCustodied.walletDid).toBe("did:key:zDnaeTESTwalletkey123");
    expect(r.selfCustodied.serverHoldsWalletKey).toBe(false); // architectural invariant
    expect(r.custodial.cashMinor).toBe("1000000"); // $10,000 ledger balance, disclosed
    expect(r.custodial.note).toMatch(/due process/i);
    expect(r.frozen).toBe(false);
    expect(r.guarantee.length).toBeGreaterThanOrEqual(3);
  });

  it("attestation is an issuer-signed JWT verifiable against the JWKS", async () => {
    const { getSignedAttestation } = await import("../src/services/selfCustodyService");
    const { getJWKS } = await import("../src/utils/tokenFactory");
    const u = await setupUser({ wallet: true });
    const { attestationJwt } = await getSignedAttestation(u);
    const { payload } = await jwtVerify(attestationJwt, createLocalJWKSet(getJWKS()), { algorithms: ["RS256"] });
    expect(payload.kind).toBe("self-custody-attestation");
    expect(payload.sub).toBe(u);
    expect((payload.report as { selfCustodied: unknown }).selfCustodied).toBeTruthy();
  });

  it("export manifest is the portable, signed 'right to exit' bundle", async () => {
    const { getExportManifest } = await import("../src/services/selfCustodyService");
    const { getJWKS } = await import("../src/utils/tokenFactory");
    const u = await setupUser({ wallet: true, hedera: true });
    const { manifest, signedManifestJwt } = await getExportManifest(u);
    expect(manifest.walletDid).toBe("did:key:zDnaeTESTwalletkey123");
    expect(manifest.credentialJwt).toBeTruthy();
    expect(manifest.hedera?.accountId).toMatch(/^0\.0\.\d+$/);
    expect(manifest.instructions.length).toBeGreaterThanOrEqual(3);
    // Signed + verifiable.
    const { payload } = await jwtVerify(signedManifestJwt, createLocalJWKSet(getJWKS()), { algorithms: ["RS256"] });
    expect(payload.kind).toBe("self-custody-export");
  });

  it("on-chain account surfaces with serverHoldsKey=false (on-device, non-custodial)", async () => {
    const { getSelfCustodyReport } = await import("../src/services/selfCustodyService");
    const u = await setupUser({ hedera: true });
    const r = await getSelfCustodyReport(u);
    expect(r.selfCustodied.hedera?.accountId).toMatch(/^0\.0\.\d+$/);
    expect(r.selfCustodied.hedera?.serverHoldsKey).toBe(false); // no key stored ⇒ device-held
  });
});
