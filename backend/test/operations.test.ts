/**
 * Phase 15 — internal agent operations runner.
 *
 * Covers the one invariant (agents recommend; deterministic RBAC gate executes):
 *   - auto_approve workflow → executes inline; agent_runs records it.
 *   - human_required workflow → queued (never auto-executes); a compliance human
 *     resolves it; execute runs only then.
 *   - RBAC: a support admin cannot resolve a compliance-gated review.
 *   - confidence floor + invoke failure → auto-escalate to a human.
 *   - kill-switch (OPERATIONS_ENABLED=false) blocks runs.
 *   - agent_runs is append-only.
 *   - scoped skill client denies an ungranted tool scope.
 *   - KYC Review (15.1) end to end: queued → compliance approve → user reaches Tier 2.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { defineSkill, createScopedClient } from "../src/operations/skillRegistry";
import {
  runOperation,
  resolveReview,
  listReviews,
  registerWorkflow,
  type WorkflowDef,
  type AdminActor,
} from "../src/operations/operationsWorkflow";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-operations-${Date.now()}.db`;
const compliance: AdminActor = { adminId: "admin-1", role: "compliance" };
const support: AdminActor = { adminId: "support-1", role: "support" };

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initKeyVault } = await import("../src/services/keyVaultService");
  initKeyVault();
  const { initTokenFactory } = await import("../src/utils/tokenFactory"); // initializes didService (VC signing)
  await initTokenFactory();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

// A trivial skill + executed flag, for exercising the generic runner.
let executed: string[] = [];
const probeSkill = defineSkill({
  name: "probe",
  version: "1.0.0",
  tools: { read_thing: { scope: "probe:read", handler: async () => ({ ok: true }) } },
});

function makeWorkflow(over: Partial<WorkflowDef>): WorkflowDef {
  const base: WorkflowDef = {
    skill: "probe",
    version: "1.0.0",
    supervision: "auto_approve",
    scopes: ["probe:read"],
    skillDef: probeSkill,
    gather: async () => ({ ctx: {}, subjectUserId: undefined }),
    invoke: async (_ctx, client) => {
      await client.call("read_thing");
      return { rec: { note: "ok" }, confidence: 0.9 };
    },
    gate: () => ({ action: "approve", reason: "auto" }),
    execute: async () => { executed.push("auto"); },
    executeApproved: async () => { executed.push("human"); },
  };
  return { ...base, ...over };
}

describe("scoped skill client", () => {
  it("denies a tool outside the granted scopes", async () => {
    const client = createScopedClient(probeSkill, []); // no scopes granted
    await expect(client.call("read_thing")).rejects.toMatchObject({ code: ErrorCode.SCOPE_DENIED });
  });
  it("records invocations for the audit trail", async () => {
    const client = createScopedClient(probeSkill, ["probe:read"]);
    await client.call("read_thing");
    expect(client.getCalls()).toEqual([expect.objectContaining({ tool: "read_thing", scope: "probe:read" })]);
  });
});

describe("runner — auto_approve", () => {
  it("executes inline and records an agent_run", async () => {
    executed = [];
    registerWorkflow(makeWorkflow({ skill: "probe-auto" }));
    const def = makeWorkflow({ skill: "probe-auto" });
    const res = await runOperation(def, {});
    expect(res.outcome).toBe("executed");
    expect(executed).toEqual(["auto"]);

    const { getDb } = await import("../src/db");
    const row = await getDb().queryOne<{ outcome: string }>(
      "SELECT outcome FROM agent_runs WHERE workflow_run = ?", [res.workflowRun]
    );
    expect(row?.outcome).toBe("executed");
  });
});

describe("runner — human_required", () => {
  it("queues instead of executing, then a compliance human resolves it", async () => {
    executed = [];
    const def = makeWorkflow({ skill: "probe-human", supervision: "human_required" });
    registerWorkflow(def);
    const res = await runOperation(def, {});
    expect(res.outcome).toBe("queued");
    expect(res.reviewId).toBeTruthy();
    expect(executed).toEqual([]); // nothing executed without a human

    // support cannot resolve a compliance-gated review
    await expect(resolveReview(res.reviewId!, support, "approve")).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    const resolved = await resolveReview(res.reviewId!, compliance, "approve");
    expect(resolved.outcome).toBe("executed");
    expect(executed).toEqual(["human"]);
  });

  it("a rejected review does not execute", async () => {
    executed = [];
    const def = makeWorkflow({ skill: "probe-human2", supervision: "human_required" });
    registerWorkflow(def);
    const res = await runOperation(def, {});
    const resolved = await resolveReview(res.reviewId!, compliance, "reject", "not enough evidence");
    expect(resolved.outcome).toBe("rejected");
    expect(executed).toEqual([]);
  });
});

describe("runner — containment", () => {
  it("escalates on low confidence even for an auto_approve workflow", async () => {
    const def = makeWorkflow({
      skill: "probe-lowconf",
      invoke: async () => ({ rec: { note: "weak" }, confidence: 0.1 }),
    });
    registerWorkflow(def);
    const res = await runOperation(def, {});
    expect(res.outcome).toBe("queued");
  });

  it("escalates when invoke throws (circuit breaker)", async () => {
    const def = makeWorkflow({
      skill: "probe-throw",
      invoke: async () => { throw new Error("LLM down"); },
    });
    registerWorkflow(def);
    const res = await runOperation(def, {});
    expect(res.outcome).toBe("queued");
  });

  it("kill-switch blocks runs", async () => {
    const { config } = await import("../src/config");
    (config as { OPERATIONS_ENABLED: boolean }).OPERATIONS_ENABLED = false;
    try {
      const def = makeWorkflow({ skill: "probe-killed" });
      await expect(runOperation(def, {})).rejects.toMatchObject({ code: ErrorCode.AGENT_DISABLED });
    } finally {
      (config as { OPERATIONS_ENABLED: boolean }).OPERATIONS_ENABLED = true;
    }
  });
});

describe("agent_runs is append-only", () => {
  it("rejects UPDATE", async () => {
    const def = makeWorkflow({ skill: "probe-append" });
    registerWorkflow(def);
    const res = await runOperation(def, {});
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE agent_runs SET outcome = 'tampered' WHERE workflow_run = ?", [res.workflowRun])
    ).rejects.toThrow(/append-only/);
  });
});

describe("KYC Review skill (15.1) end to end", () => {
  it("queues, then a compliance approval grants the user Tier 2", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getProfile } = await import("../src/services/identityService");
    const { kycReviewWorkflow } = await import("../src/operations/skills/kycReviewSkill");
    const { getDb } = await import("../src/db");

    const user = await createUser(`kyc-rev-${Date.now()}@test.com`, "Clean Applicant");
    const before = await getProfile(user.id);
    expect(before?.tier ?? 0).toBeLessThan(2);

    const res = await runOperation(kycReviewWorkflow as WorkflowDef, {
      userId: user.id, fullName: "Clean Applicant", documentNumber: "DOC-123",
    });
    expect(res.outcome).toBe("queued");

    // The recommendation is on the queued review for the human to see.
    const review = await getDb().queryOne<{ recommendation: string; subject_user_id: string }>(
      "SELECT recommendation, subject_user_id FROM agent_reviews WHERE id = ?", [res.reviewId!]
    );
    expect(JSON.parse(review!.recommendation).recommendation).toBe("approve");
    expect(review!.subject_user_id).toBe(user.id);

    const resolved = await resolveReview(res.reviewId!, compliance, "approve");
    expect(resolved.outcome).toBe("executed");

    const after = await getProfile(user.id);
    expect(after?.tier).toBe(2); // deterministic grant ran, not the agent
  });

  it("recommends reject for a sanctioned name (advisory; human still gates)", async () => {
    const { createUser } = await import("../src/services/authService");
    const { kycReviewWorkflow } = await import("../src/operations/skills/kycReviewSkill");
    const { getDb } = await import("../src/db");

    const user = await createUser(`kyc-sanc-${Date.now()}@test.com`, "Blocked Person");
    const res = await runOperation(kycReviewWorkflow as WorkflowDef, {
      userId: user.id, fullName: "Blocked Person", documentNumber: "DOC-9", // on the sanctions denylist
    });
    expect(res.outcome).toBe("queued");

    const review = await getDb().queryOne<{ recommendation: string }>(
      "SELECT recommendation FROM agent_reviews WHERE id = ?", [res.reviewId!]
    );
    expect(JSON.parse(review!.recommendation).recommendation).toBe("reject");

    const pending = await listReviews("pending");
    expect(pending.some((r) => r.workflow_run === res.workflowRun)).toBe(true);
  });
});
