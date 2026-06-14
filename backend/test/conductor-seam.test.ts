/**
 * Phase 15.4 — Conductor engine adapter (deterministic, no server required).
 *
 * The live e2e is proven by `npm run conductor:live-check` against a real server. Here
 * we assert the adapter degrades to in-process when the server is unreachable — full
 * behavior parity (a KYC review still queues, a compliance approval still grants Tier 2
 * through the deterministic services). CONDUCTOR_URL points at an unreachable address so
 * the fetch fails fast regardless of whether a server is running locally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { setEngine } from "../src/operations/engine";
import { runOperation, resolveReview, type WorkflowDef, type AdminActor } from "../src/operations/operationsWorkflow";
import { createConductorEngine } from "../src/operations/conductor/conductorEngine";

const TMP_DB = `./data/test-conductor-${Date.now()}.db`;
const compliance: AdminActor = { adminId: "admin-1", role: "compliance" };

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initKeyVault } = await import("../src/services/keyVaultService");
  initKeyVault();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  await import("../src/operations/skills/kycReviewSkill");
});

afterAll(async () => {
  setEngine(null);
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("Conductor engine degrades to in-process when unavailable", () => {
  it("execute + resolve still drive a full KYC review to Tier 2", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getProfile } = await import("../src/services/identityService");
    const { kycReviewWorkflow } = await import("../src/operations/skills/kycReviewSkill");
    const { config } = await import("../src/config");

    const orig = config.CONDUCTOR_URL;
    (config as { CONDUCTOR_URL: string }).CONDUCTOR_URL = "http://127.0.0.1:1/api"; // unreachable
    setEngine(createConductorEngine());
    try {
      const user = await createUser(`cond-${Date.now()}@test.com`, "Clean Applicant");
      const res = await runOperation(kycReviewWorkflow as WorkflowDef, {
        userId: user.id, fullName: "Clean Applicant", documentNumber: "DOC-1",
      });
      expect(res.outcome).toBe("queued");
      expect(res.reviewId).toBeTruthy();

      const resolved = await resolveReview(res.reviewId!, compliance, "approve");
      expect(resolved.outcome).toBe("executed");
      expect((await getProfile(user.id))?.tier).toBe(2);
    } finally {
      setEngine(null);
      (config as { CONDUCTOR_URL: string }).CONDUCTOR_URL = orig;
    }
  }, 20000);
});
