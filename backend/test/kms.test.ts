/**
 * Phase 20 — key-vault custody (closes Phase-14 invariant *m* / audit C-1).
 *
 * Covers:
 *   - AEAD provider security properties: round-trip, AAD binding, wrong master
 *     key, ciphertext tamper, malformed input.
 *   - Real secrets are wrapped at rest, not plaintext, and stay usable:
 *       did_keys.private_jwk  — wrapped on persist + lazily migrated on load (initDid),
 *                               issuer can still sign/verify afterwards.
 *       hedera_accounts       — backfill wraps a legacy plaintext key, nulls the
 *                               plaintext, and the wrapped value unwraps to a usable key.
 *   - productionFatals refuses KMS_PROVIDER=local in production (the gate that
 *     actually closes invariant m).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, importJWK, type JWK } from "jose";
import { PrivateKey } from "@hashgraph/sdk";
import { v4 as uuidv4 } from "uuid";
import {
  localAeadProvider,
  setKeyVaultProvider,
  getKeyVault,
  isWrapped,
  WRAP_PREFIX,
} from "../src/services/keyVaultService";
import { productionFatals } from "../src/config";

const TMP_DB = `./data/test-kms-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";

  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("local AEAD provider", () => {
  const vault = localAeadProvider();

  it("round-trips a secret and binds it to the AAD", async () => {
    const wrapped = await vault.wrap("super-secret-der", { aad: "user-1" });
    expect(isWrapped(wrapped)).toBe(true);
    expect(wrapped.startsWith(WRAP_PREFIX)).toBe(true);
    expect(wrapped).not.toContain("super-secret-der");
    expect(await vault.unwrap(wrapped, { aad: "user-1" })).toBe("super-secret-der");
  });

  it("rejects an AAD mismatch (ciphertext can't be lifted to another row)", async () => {
    const wrapped = await vault.wrap("secret", { aad: "user-1" });
    await expect(vault.unwrap(wrapped, { aad: "user-2" })).rejects.toThrow();
  });

  it("rejects a wrong master key (no silent plaintext fallback)", async () => {
    // Build a provider with key A, wrap, then build one with key B and confirm B
    // cannot decrypt A's ciphertext. localAeadProvider() reads config.KMS_MASTER_KEY
    // at construction, so swap it on the shared config singleton between builds.
    const { config } = await import("../src/config");
    const orig = config.KMS_MASTER_KEY;
    try {
      (config as { KMS_MASTER_KEY?: string }).KMS_MASTER_KEY = Buffer.alloc(32, 0xaa).toString("base64");
      const wrapped = await localAeadProvider().wrap("secret", { aad: "user-1" });
      (config as { KMS_MASTER_KEY?: string }).KMS_MASTER_KEY = Buffer.alloc(32, 0xbb).toString("base64");
      await expect(localAeadProvider().unwrap(wrapped, { aad: "user-1" })).rejects.toThrow();
    } finally {
      (config as { KMS_MASTER_KEY?: string }).KMS_MASTER_KEY = orig;
    }
  });

  it("rejects ciphertext tamper (GCM auth failure)", async () => {
    const wrapped = await vault.wrap("secret-payload", { aad: "user-1" });
    await expect(vault.unwrap(corruptPart(wrapped, 2), { aad: "user-1" })).rejects.toThrow();
  });

  it("rejects malformed input", async () => {
    await expect(vault.unwrap("not-wrapped", { aad: "x" })).rejects.toThrow();
    await expect(vault.unwrap(WRAP_PREFIX + "only.two", { aad: "x" })).rejects.toThrow();
  });
});

describe("did_keys are wrapped at rest and stay usable", () => {
  it("wraps a legacy raw-JSON private_jwk on load and the issuer can still sign", async () => {
    const { getDb } = await import("../src/db");
    setKeyVaultProvider(localAeadProvider());
    const db = getDb();

    // Seed a LEGACY (plaintext raw-JSON) issuer key row, as a pre-Phase-20 DB would have.
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const kid = uuidv4();
    const privateJwk = JSON.stringify(await exportJWK(privateKey));
    const publicJwk = JSON.stringify(await exportJWK(publicKey));
    await db.execute(
      `INSERT INTO did_keys (kid, algorithm, private_jwk, public_jwk, active, created_at)
       VALUES (?, 'RS256', ?, ?, 1, ?)`,
      [kid, privateJwk, publicJwk, new Date().toISOString()]
    );
    expect(isWrapped(privateJwk)).toBe(false);

    // initDid loads the legacy row → should lazily wrap the column in place.
    const { initDid, getActiveKey } = await import("../src/services/didService");
    await initDid();

    const row = await db.queryOne<{ private_jwk: string }>(
      "SELECT private_jwk FROM did_keys WHERE kid = ?",
      [kid]
    );
    expect(isWrapped(row!.private_jwk)).toBe(true); // no longer plaintext

    // The wrapped key is still a working signing key.
    const active = getActiveKey();
    const jwt = await new SignJWT({ hi: "there" })
      .setProtectedHeader({ alg: "RS256", kid: active.kid })
      .sign(active.privateKey);
    const verified = await jwtVerify(jwt, active.publicKey);
    expect(verified.payload.hi).toBe("there");

    setKeyVaultProvider(null);
  });

  it("column scan: no did_keys row stores raw-JSON plaintext after load", async () => {
    const { getDb } = await import("../src/db");
    const rows = await getDb().query<{ private_jwk: string }>("SELECT private_jwk FROM did_keys");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(isWrapped(r.private_jwk)).toBe(true);
      expect(r.private_jwk.trimStart().startsWith("{")).toBe(false);
    }
  });
});

describe("hedera keys are wrapped at rest", () => {
  it("backfill wraps a legacy plaintext key, nulls plaintext, and the result is a usable key", async () => {
    const { getDb } = await import("../src/db");
    const { createUser } = await import("../src/services/authService");
    setKeyVaultProvider(localAeadProvider());
    const db = getDb();
    const vault = getKeyVault();

    const user = await createUser(`kms-${Date.now()}@test.com`, "KMS User");
    const der = PrivateKey.generateED25519().toStringDer();

    // Seed a LEGACY plaintext hedera_accounts row (pre-Phase-20). Unique on-chain
    // id so the row survives a DB shared with other suites in the same worker.
    await db.execute(
      `INSERT INTO hedera_accounts (id, user_id, hedera_account_id, public_key, private_key_hex)
       VALUES (?, ?, ?, 'pub', ?)`,
      [uuidv4(), user.id, `0.0.${Date.now()}${Math.floor(Math.random() * 1000)}`, der]
    );

    // Backfill: wrap + null the plaintext (mirrors npm run encrypt-keys / loadSignerKey).
    const legacy = await db.queryOne<{ id: string; private_key_hex: string }>(
      "SELECT id, private_key_hex FROM hedera_accounts WHERE user_id = ?",
      [user.id]
    );
    const enc = await vault.wrap(legacy!.private_key_hex, { aad: user.id });
    await db.execute(
      "UPDATE hedera_accounts SET private_key_enc = ?, private_key_hex = NULL WHERE id = ?",
      [enc, legacy!.id]
    );

    const after = await db.queryOne<{ private_key_hex: string | null; private_key_enc: string | null }>(
      "SELECT private_key_hex, private_key_enc FROM hedera_accounts WHERE user_id = ?",
      [user.id]
    );
    expect(after!.private_key_hex).toBeNull();                 // plaintext gone
    expect(isWrapped(after!.private_key_enc!)).toBe(true);     // wrapped present

    // Unwraps (AAD-bound to the userId) back to the original, usable DER key.
    const recovered = await vault.unwrap(after!.private_key_enc!, { aad: user.id });
    expect(recovered).toBe(der);
    expect(() => PrivateKey.fromStringDer(recovered)).not.toThrow();

    setKeyVaultProvider(null);
  });

  it("column scan: no hedera_accounts row stores a plaintext private key", async () => {
    const { getDb } = await import("../src/db");
    const rows = await getDb().query<{ private_key_hex: string | null }>(
      "SELECT private_key_hex FROM hedera_accounts"
    );
    for (const r of rows) {
      expect(r.private_key_hex).toBeNull();
    }
  });
});

describe("m. production refuses the local key-vault stand-in", () => {
  it("productionFatals flags KMS_PROVIDER=local in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(48),
      ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false,
      HEDERA_ENABLED: false,
      KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated",
      SMARTCHAT_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "",
      HEDERA_OPERATOR_ID: "",
      HEDERA_OPERATOR_KEY: "",
    } as unknown as Parameters<typeof productionFatals>[0];

    expect(productionFatals(base)).toEqual([]); // real KMS → clean
    const local = { ...base, KMS_PROVIDER: "local" } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(local).some((f) => f.includes("KMS_PROVIDER"))).toBe(true);
  });
});

/** Corrupt one base64url segment of a wrapped value (index: 0=iv,1=tag,2=ct). */
function corruptPart(wrapped: string, index: number): string {
  const parts = wrapped.slice(WRAP_PREFIX.length).split(".");
  const buf = Buffer.from(parts[index]!, "base64url");
  buf[0] = buf[0]! ^ 0xff;
  parts[index] = buf.toString("base64url");
  return WRAP_PREFIX + parts.join(".");
}
