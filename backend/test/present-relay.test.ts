/**
 * Phase 10 — OID4VP token relay. The wallet mints a scoped token at /api/present; the
 * relay parks it by nonce for the requesting agent to fetch ONCE (single-use + TTL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import type { ScopedTokenResult } from "../src/services/presentationService";

// Dynamic import after beforeAll sets SQLITE_PATH (the project's test convention).
const svc = () => import("../src/services/presentationService");

const TMP_DB = `./data/test-present-relay-${Date.now()}.db`;

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

function tokenFor(nonce: string): ScopedTokenResult {
  return {
    accessToken: `tok-${uuidv4()}`, tokenType: "Bearer", expiresIn: 90,
    scope: ["transfer:low"], jti: uuidv4(), userId: uuidv4(), clientDid: "did:simulator:agent-app", nonce,
  };
}

describe("OID4VP token relay", () => {
  it("delivers the token once, then denies a second fetch", async () => {
    const { storePendingToken, fetchPendingToken } = await svc();
    const nonce = uuidv4().replace(/-/g, "");
    await storePendingToken(tokenFor(nonce));

    const first = await fetchPendingToken(nonce);
    expect(first?.token_type).toBe("Bearer");
    expect(first?.scope).toEqual(["transfer:low"]);
    expect(first?.access_token).toMatch(/^tok-/);

    expect(await fetchPendingToken(nonce)).toBeNull(); // single-use
  });

  it("returns null for an unknown nonce", async () => {
    const { fetchPendingToken } = await svc();
    expect(await fetchPendingToken("does-not-exist")).toBeNull();
  });

  it("denies an expired relay entry", async () => {
    const { storePendingToken, fetchPendingToken } = await svc();
    const nonce = uuidv4().replace(/-/g, "");
    await storePendingToken(tokenFor(nonce));
    const { getDb } = await import("../src/db");
    await getDb().execute("UPDATE present_relay_tokens SET expires_at = ? WHERE nonce = ?", ["2000-01-01T00:00:00.000Z", nonce]);
    expect(await fetchPendingToken(nonce)).toBeNull();
  });
});
