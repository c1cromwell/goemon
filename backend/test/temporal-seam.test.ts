/**
 * Phase 15.4 — workflow-engine seam + Temporal adapter.
 *
 * The Temporal server/SDK is not available in CI, so these assert the seam itself:
 *   - default engine is in-process; setEngine swaps it; getEngine reflects the choice.
 *   - runOperation/resolveReview route through the active engine.
 *   - the Temporal engine degrades to in-process when the SDK/server is unavailable —
 *     full behavior parity (a KYC review still queues, and a human approval still
 *     grants Tier 2 through the deterministic services).
 *   - the Temporal activities delegate to the same in-process logic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { getEngine, setEngine, type WorkflowEngine } from "../src/operations/engine";
import { runOperation, resolveReview, type WorkflowDef, type RunResult, type AdminActor } from "../src/operations/operationsWorkflow";
import { createTemporalEngine } from "../src/operations/temporal/temporalEngine";
import { runOperationActivity, resolveReviewActivity } from "../src/operations/temporal/activities";

const TMP_DB = `./data/test-temporal-${Date.now()}.db`;
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
  await import("../src/operations/skills/kycReviewSkill"); // register kyc-review
});

afterAll(async () => {
  setEngine(null);
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("engine seam", () => {
  it("defaults to the in-process engine", () => {
    expect(getEngine().name).toBe("in_process");
  });

  it("setEngine routes runOperation through the active engine", async () => {
    const calls: string[] = [];
    const stub: WorkflowEngine = {
      name: "stub",
      execute: async (): Promise<RunResult> => { calls.push("execute"); return { runId: "r", workflowRun: "w", outcome: "executed" }; },
      resolve: async (): Promise<RunResult> => { calls.push("resolve"); return { runId: "r", workflowRun: "w", outcome: "executed" }; },
    };
    setEngine(stub);
    try {
      expect(getEngine().name).toBe("stub");
      const res = await runOperation({ skill: "x" } as unknown as WorkflowDef, {});
      expect(res.outcome).toBe("executed");
      await resolveReview("rid", compliance, "approve");
      expect(calls).toEqual(["execute", "resolve"]);
    } finally {
      setEngine(null);
    }
    expect(getEngine().name).toBe("in_process"); // reverted to default
  });
});

describe("Temporal engine degrades to in-process when unavailable", () => {
  it("execute + resolve still drive a full KYC review to Tier 2", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getProfile } = await import("../src/services/identityService");
    const { kycReviewWorkflow } = await import("../src/operations/skills/kycReviewSkill");

    // No Temporal SDK/server in CI → connectClient throws → falls back to in-process.
    setEngine(createTemporalEngine());
    try {
      const user = await createUser(`temporal-${Date.now()}@test.com`, "Clean Applicant");
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
    }
  });
});

describe("Temporal activities delegate to the in-process logic", () => {
  it("runOperationActivity queues, resolveReviewActivity resolves", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getProfile } = await import("../src/services/identityService");

    const user = await createUser(`activity-${Date.now()}@test.com`, "Clean Applicant");
    const res = await runOperationActivity("kyc-review", {
      userId: user.id, fullName: "Clean Applicant", documentNumber: "DOC-2",
    });
    expect(res.outcome).toBe("queued");

    const resolved = await resolveReviewActivity(res.reviewId!, compliance, "approve");
    expect(resolved.outcome).toBe("executed");
    expect((await getProfile(user.id))?.tier).toBe(2);
  });
});
