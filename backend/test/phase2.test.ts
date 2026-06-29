/**
 * Phase 2 — DID & VC tests.
 *
 * Verifies:
 *   1. initTokenFactory persists a key and reloads it without generating a new one
 *   2. issueCredential returns a verifiable JWT
 *   3. Issued VC has correct claims (kycStatus, tier, allowedOps)
 *   4. statusListService.revoke flips exactly the right bit
 *   5. Revoked credential shows revoked in the status list
 *   6. rotateKey adds a second entry to JWKS; old tokens still verify
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { jwtVerify, createLocalJWKSet } from "jose";

const TMP_DB = `./data/test-phase2-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
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

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
}

describe("Phase 2: DID key persistence", () => {
  beforeAll(setup);

  it("initDid persists a key in did_keys on first call", async () => {
    const { getDb } = await import("../src/db");
    const rows = await getDb().query("SELECT * FROM did_keys");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("re-calling initDid does not generate a second key", async () => {
    const { initDid } = await import("../src/services/didService");
    await initDid(); // second call — should be idempotent
    const { getDb } = await import("../src/db");
    const rows = await getDb().query("SELECT * FROM did_keys WHERE active = 1");
    expect(rows.length).toBe(1);
  });

  it("getJWKS returns the persisted key", async () => {
    const { getJWKS } = await import("../src/utils/tokenFactory");
    const jwks = getJWKS();
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1);
    expect(jwks.keys[0]).toHaveProperty("kid");
    expect(jwks.keys[0]).toHaveProperty("use", "sig");
    expect(jwks.keys[0]).toHaveProperty("alg", "RS256");
  });
});

describe("Phase 2: VC issuance and verification", () => {
  const userId = "user-vc-test-1";

  beforeAll(async () => {
    const { getDb } = await import("../src/db");
    await getDb().execute(
      "INSERT OR IGNORE INTO users (id, email, full_name) VALUES (?, ?, ?)",
      [userId, "vc@test.com", "VC Tester"]
    );
  });

  it("issueCredential returns a signed JWT", async () => {
    const { issueCredential } = await import("../src/services/vcService");
    const { getJWKS } = await import("../src/utils/tokenFactory");

    const jwt = await issueCredential(userId, 2);
    expect(typeof jwt).toBe("string");
    expect(jwt.split(".").length).toBe(3); // header.payload.sig

    // Verify against the JWKS
    const localKeySet = createLocalJWKSet(getJWKS());
    const { payload } = await jwtVerify(jwt, localKeySet, { algorithms: ["RS256"] });
    expect(payload).toBeTruthy();
  });

  it("VC JWT contains correct claims", async () => {
    const { getCredential } = await import("../src/services/vcService");
    const { getJWKS } = await import("../src/utils/tokenFactory");

    const row = await getCredential(userId);
    expect(row?.vc_jwt).toBeTruthy();
    expect(row?.revoked).toBe(0);

    const localKeySet = createLocalJWKSet(getJWKS());
    const { payload } = await jwtVerify(row!.vc_jwt!, localKeySet, { algorithms: ["RS256"] });
    const vc = (payload as { vc?: Record<string, unknown> }).vc;
    expect(vc).toBeTruthy();

    const subject = (vc as { credentialSubject?: Record<string, unknown> }).credentialSubject;
    expect(subject).toMatchObject({
      kycStatus: "PASSED",
      tier: 2,
    });
    expect(Array.isArray((subject as { allowedOps?: unknown }).allowedOps)).toBe(true);
  });

  it("VC JWT has a credentialStatus field pointing to the status list", async () => {
    const { getCredential } = await import("../src/services/vcService");
    const { getJWKS } = await import("../src/utils/tokenFactory");

    const row = await getCredential(userId);
    const localKeySet = createLocalJWKSet(getJWKS());
    const { payload } = await jwtVerify(row!.vc_jwt!, localKeySet, { algorithms: ["RS256"] });
    const vc = (payload as { vc?: Record<string, unknown> }).vc!;
    const status = (vc as { credentialStatus?: Record<string, unknown> }).credentialStatus;
    expect(status).toHaveProperty("type", "BitstringStatusListEntry");
    expect(status).toHaveProperty("statusPurpose", "revocation");
    expect(status).toHaveProperty("statusListIndex");
  });
});

describe("Phase 2: BitstringStatusList revocation", () => {
  it("newly assigned index is not revoked", async () => {
    const { assignIndex, getEncodedList, isRevoked } = await import("../src/services/statusListService");
    const year = new Date().getFullYear();
    const index = await assignIndex(year);
    const encoded = await getEncodedList(year);
    expect(isRevoked(encoded, index)).toBe(false);
  });

  it("revoke sets exactly the right bit", async () => {
    const { assignIndex, revoke, getEncodedList, isRevoked } = await import("../src/services/statusListService");
    const year = new Date().getFullYear();
    const index = await assignIndex(year);
    await revoke(year, index);

    const encoded = await getEncodedList(year);
    expect(isRevoked(encoded, index)).toBe(true);
    // Adjacent bits must be untouched
    if (index > 0) expect(isRevoked(encoded, index - 1)).toBe(false);
    expect(isRevoked(encoded, index + 1)).toBe(false);
  });

  it("revokeCredential flips the status list bit", async () => {
    const userId2 = "user-revoke-test-1";
    const { getDb } = await import("../src/db");
    await getDb().execute(
      "INSERT OR IGNORE INTO users (id, email, full_name) VALUES (?, ?, ?)",
      [userId2, "revoke@test.com", "Revoke Tester"]
    );

    const { issueCredential, revokeCredential, getCredential } = await import("../src/services/vcService");
    const { getEncodedList, isRevoked } = await import("../src/services/statusListService");

    await issueCredential(userId2, 2);
    const row = await getCredential(userId2);
    expect(row?.revoked).toBe(0);

    await revokeCredential(row!.id, userId2, "test_revocation");

    const updated = await getCredential(userId2);
    expect(updated?.revoked).toBe(1);

    const year = new Date(row!.issued_at).getFullYear();
    const encoded = await getEncodedList(year);
    expect(isRevoked(encoded, row!.status_index!)).toBe(true);
  });
});

describe("Phase 2: Key rotation", () => {
  it("rotateKey adds a second key to JWKS without invalidating old tokens", async () => {
    const { mintScopedToken, verifyToken, getJWKS } = await import("../src/utils/tokenFactory");
    const { rotateKey } = await import("../src/services/didService");

    // Mint a token with the current key
    const token = await mintScopedToken("jti-rotation-test", "did:web:goemanglobal.com:users:u1", "did:web:ext", ["balance:read"], 300);

    // Rotate
    await rotateKey();

    // JWKS now has 2 keys
    const jwks = getJWKS();
    expect(jwks.keys.length).toBe(2);

    // Old token still verifies
    const verified = await verifyToken(token);
    expect(verified.payload.sub).toBe("did:web:goemanglobal.com:users:u1");
  });
});
