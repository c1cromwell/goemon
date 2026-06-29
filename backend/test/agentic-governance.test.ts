/**
 * M2 — Agentic OS governance: CEO/CS gates, gate policy, milestone sign-offs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import type { WorkflowDef, AdminActor } from "../src/operations/operationsWorkflow";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-agentic-gov-${Date.now()}.db`;

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

describe("gate policy", () => {
  it("escalates CEO-gated financial outputs to ceo + chief_of_staff", async () => {
    const { applyCeoGatePolicy } = await import("../src/operations/gatePolicy");
    const d = applyCeoGatePolicy("cfo-report", "financial_output", { action: "approve", reason: "ok" });
    expect(d.action).toBe("escalate");
    expect(d.requiresRole).toEqual(["ceo", "chief_of_staff"]);
    expect(d.outputClass).toBe("financial_output");
  });

  it("passes through non-CEO workflows unchanged", async () => {
    const { applyCeoGatePolicy } = await import("../src/operations/gatePolicy");
    const d = applyCeoGatePolicy("kyc-review", undefined, { action: "approve", reason: "ok" });
    expect(d.action).toBe("approve");
  });
});

describe("CEO approval queue", () => {
  it("queues product launch for CEO/CS — admin cannot resolve", async () => {
    const { defineSkill } = await import("../src/operations/skillRegistry");
    const { runOperation, resolveReview, listReviewsForActor, registerWorkflow } = await import(
      "../src/operations/operationsWorkflow"
    );

    let executed = false;
    const launchSkill = defineSkill({
      name: "product-launch",
      version: "1.0.0",
      tools: { read_launch: { scope: "launch:read", handler: async () => ({ ok: true }) } },
    });

    const launchWorkflow: WorkflowDef = {
      skill: "product-launch",
      version: "1.0.0",
      supervision: "auto_approve",
      outputClass: "product_launch",
      scopes: ["launch:read"],
      skillDef: launchSkill,
      gather: async () => ({ ctx: {} }),
      invoke: async () => ({ rec: { launch: "collect-v1" }, confidence: 0.95 }),
      gate: () => ({ action: "approve", reason: "ready" }),
      execute: async () => { executed = true; },
      executeApproved: async () => { executed = true; },
    };
    registerWorkflow(launchWorkflow);

    const ceo: AdminActor = { adminId: "ceo-1", role: "ceo" };
    const admin: AdminActor = { adminId: "admin-1", role: "admin" };

    const run = await runOperation(launchWorkflow, {});
    expect(run.outcome).toBe("queued");
    expect(run.reviewId).toBeTruthy();
    expect(executed).toBe(false);

    const ceoQueue = await listReviewsForActor("ceo");
    expect(ceoQueue.some((r) => r.id === run.reviewId)).toBe(true);
    expect(ceoQueue.find((r) => r.id === run.reviewId)?.output_class).toBe("product_launch");

    await expect(
      resolveReview(run.reviewId!, admin, "approve", "admin bypass attempt")
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    await resolveReview(run.reviewId!, ceo, "approve", "CEO launch approved");
    expect(executed).toBe(true);
  });

  it("chief_of_staff can resolve CEO-gated review (backup)", async () => {
    const { defineSkill } = await import("../src/operations/skillRegistry");
    const { runOperation, resolveReview, registerWorkflow } = await import("../src/operations/operationsWorkflow");

    let executed = false;
    const launchSkill = defineSkill({
      name: "product-launch",
      version: "1.0.0",
      tools: { read_launch: { scope: "launch:read", handler: async () => ({ ok: true }) } },
    });
    const launchWorkflow: WorkflowDef = {
      skill: "product-launch",
      version: "1.0.0",
      supervision: "auto_approve",
      outputClass: "product_launch",
      scopes: ["launch:read"],
      skillDef: launchSkill,
      gather: async () => ({ ctx: {} }),
      invoke: async () => ({ rec: { launch: "collect-v1" }, confidence: 0.95 }),
      gate: () => ({ action: "approve", reason: "ready" }),
      executeApproved: async () => { executed = true; },
    };
    registerWorkflow(launchWorkflow);

    const run = await runOperation(launchWorkflow, {});
    await resolveReview(run.reviewId!, { adminId: "cs-1", role: "chief_of_staff" }, "approve", "CS backup");
    expect(executed).toBe(true);
  });
});

describe("milestone sign-offs", () => {
  it("seeds CEO/CS accounts idempotently", async () => {
    const { seedCeoApprovers } = await import("../src/services/adminService");
    const a = await seedCeoApprovers();
    expect(a.ceo.email).toBe("ceo@goemonglobal.com");
    expect(a.cs.email).toBe("cos@goemonglobal.com");
    const b = await seedCeoApprovers();
    expect(b.ceo.created).toBe(false);
  });

  it("records CEO milestone sign-off once", async () => {
    const { signMilestone, listMilestoneStatuses } = await import("../src/services/milestoneSignoffService");
    const ceo: AdminActor = { adminId: "ceo-1", role: "ceo" };
    const signed = await signMilestone("M1", ceo, "Confirmed webview + design");
    expect(signed.signed).toBe(true);
    await expect(signMilestone("M1", ceo)).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    const all = await listMilestoneStatuses();
    expect(all.find((m) => m.id === "M1")?.signed).toBe(true);
  });
});
