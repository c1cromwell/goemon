/**
 * Phase 15.2 — remaining read-only back-office skills.
 *
 *   support-response  — human_required; support can resolve; sends on approval.
 *   incident-summary  — auto_approve_audit; drafts + executes (no remediation capability).
 *   marketing-draft   — small audience auto-passes; ≥1,000 escalates to admin (RBAC).
 *   marketplace-dd    — human_required; compliance resolves.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { runOperation, resolveReview, getWorkflow, type WorkflowDef, type AdminActor } from "../src/operations/operationsWorkflow";
import { ErrorCode } from "../src/errors";
import "../src/operations/skills";

const TMP_DB = `./data/test-backoffice-${Date.now()}.db`;
const admin: AdminActor = { adminId: "a1", role: "admin" };
const support: AdminActor = { adminId: "s1", role: "support" };

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
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

const def = (skill: string) => getWorkflow(skill) as WorkflowDef;

describe("support-response", () => {
  it("drafts and queues for a support human, who can send it", async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(`sup-${Date.now()}@test.com`, "Asker");
    const res = await runOperation(def("support-response"), { userId: user.id, question: "Why is my transfer pending?" });
    expect(res.outcome).toBe("queued");
    const resolved = await resolveReview(res.reviewId!, support, "approve");
    expect(resolved.outcome).toBe("executed");
  });
});

describe("incident-summary (SRE)", () => {
  it("drafts and auto-passes (audited), no remediation", async () => {
    const res = await runOperation(def("incident-summary"), { service: "api", symptom: "elevated 500s" });
    expect(res.outcome).toBe("executed");
  });
});

describe("marketing-draft", () => {
  it("a small audience auto-passes", async () => {
    const res = await runOperation(def("marketing-draft"), { segment: "new-users", audienceSize: 50 });
    expect(res.outcome).toBe("executed");
  });
  it("a large audience escalates and only admin can approve", async () => {
    const res = await runOperation(def("marketing-draft"), { segment: "all", audienceSize: 5000 });
    expect(res.outcome).toBe("queued");
    await expect(resolveReview(res.reviewId!, support, "approve")).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    const resolved = await resolveReview(res.reviewId!, admin, "approve");
    expect(resolved.outcome).toBe("executed");
  });
});

describe("marketplace-dd", () => {
  it("drafts a DD record and queues for compliance/admin", async () => {
    const res = await runOperation(def("marketplace-dd"), { issuer: "Acme RWA" });
    expect(res.outcome).toBe("queued");
    const resolved = await resolveReview(res.reviewId!, admin, "approve");
    expect(resolved.outcome).toBe("executed");
  });
});
