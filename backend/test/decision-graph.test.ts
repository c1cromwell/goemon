/**
 * M3 — Decision knowledge graph (append-only kg_nodes / kg_edges).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import type { WorkflowDef } from "../src/operations/operationsWorkflow";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-decision-kg-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.DECISION_KG_ENABLED = "1";
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

describe("decision knowledge graph", () => {
  it("records Decision + Agent edges on agent run", async () => {
    const { defineSkill } = await import("../src/operations/skillRegistry");
    const { runOperation, registerWorkflow } = await import("../src/operations/operationsWorkflow");
    const { getGraphByWorkflowRun } = await import("../src/services/decisionGraphService");

    const skill = defineSkill({
      name: "kg-probe",
      version: "1.0.0",
      tools: { t: { scope: "kg:read", handler: async () => ({ ok: true }) } },
    });
    const wf: WorkflowDef = {
      skill: "kg-probe",
      version: "1.0.0",
      supervision: "auto_approve",
      scopes: ["kg:read"],
      skillDef: skill,
      gather: async () => ({ ctx: {} }),
      invoke: async () => ({ rec: { ok: true }, confidence: 0.9 }),
      gate: () => ({ action: "approve", reason: "auto" }),
      execute: async () => {},
    };
    registerWorkflow(wf);

    const run = await runOperation(wf, {});
    const graph = await getGraphByWorkflowRun(run.workflowRun);
    expect(graph.nodes.some((n) => n.nodeType === "Decision")).toBe(true);
    expect(graph.nodes.some((n) => n.nodeType === "Agent" && n.title === "kg-probe")).toBe(true);
    expect(graph.edges.some((e) => e.edgeType === "decided_by")).toBe(true);
  });

  it("records Approval + gated_by on human resolve", async () => {
    const { defineSkill } = await import("../src/operations/skillRegistry");
    const { runOperation, resolveReview, registerWorkflow } = await import("../src/operations/operationsWorkflow");
    const { getGraphByWorkflowRun } = await import("../src/services/decisionGraphService");

    const skill = defineSkill({
      name: "product-launch",
      version: "1.0.0",
      tools: { t: { scope: "launch:read", handler: async () => ({ ok: true }) } },
    });
    const wf: WorkflowDef = {
      skill: "product-launch",
      version: "1.0.0",
      supervision: "auto_approve",
      outputClass: "product_launch",
      scopes: ["launch:read"],
      skillDef: skill,
      gather: async () => ({ ctx: {} }),
      invoke: async () => ({ rec: { launch: "v1" }, confidence: 0.95 }),
      gate: () => ({ action: "approve", reason: "ready" }),
      executeApproved: async () => {},
    };
    registerWorkflow(wf);

    const run = await runOperation(wf, {});
    await resolveReview(run.reviewId!, { adminId: "ceo-1", role: "ceo" }, "approve", "CEO ok");

    const graph = await getGraphByWorkflowRun(run.workflowRun);
    expect(graph.nodes.some((n) => n.nodeType === "Approval")).toBe(true);
    expect(graph.edges.some((e) => e.edgeType === "gated_by")).toBe(true);
    expect(graph.nodes.some((n) => n.scope === "product")).toBe(true);
  });

  it("kg_nodes and kg_edges are append-only", async () => {
    const { defineSkill } = await import("../src/operations/skillRegistry");
    const { runOperation, registerWorkflow } = await import("../src/operations/operationsWorkflow");
    const { getDb } = await import("../src/db");

    const skill = defineSkill({
      name: "kg-append",
      version: "1.0.0",
      tools: { t: { scope: "kg:read", handler: async () => ({ ok: true }) } },
    });
    const wf: WorkflowDef = {
      skill: "kg-append",
      version: "1.0.0",
      supervision: "auto_approve",
      scopes: ["kg:read"],
      skillDef: skill,
      gather: async () => ({ ctx: {} }),
      invoke: async () => ({ rec: {}, confidence: 1 }),
      gate: () => ({ action: "approve", reason: "auto" }),
      execute: async () => {},
    };
    registerWorkflow(wf);
    const run = await runOperation(wf, {});
    const db = getDb();
    const node = await db.queryOne<{ id: string }>(
      "SELECT id FROM kg_nodes WHERE ref_id = ?",
      [run.runId]
    );
    expect(node).toBeTruthy();
    await expect(db.execute("UPDATE kg_nodes SET title = 'x' WHERE id = ?", [node!.id])).rejects.toThrow(/append-only/i);
  });

  it("records milestone sign-off in KG", async () => {
    const { signMilestone } = await import("../src/services/milestoneSignoffService");
    const { exportGraph } = await import("../src/services/decisionGraphService");

    await signMilestone("M3", { adminId: "ceo-kg", role: "ceo" }, "M3 test signoff");
    const graph = await exportGraph({ scope: "corporate", limit: 50 });
    expect(graph.nodes.some((n) => n.refType === "milestone" && n.refId === "M3")).toBe(true);
  });

  it("rejects duplicate milestone sign-off", async () => {
    const { signMilestone } = await import("../src/services/milestoneSignoffService");
    await expect(signMilestone("M3", { adminId: "ceo-kg", role: "ceo" })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
  });
});
