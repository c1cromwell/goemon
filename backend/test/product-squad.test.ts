/**
 * M6 — Product squad + PDLC orchestrator + product KG.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import type { AdminActor } from "../src/operations/operationsWorkflow";

const TMP_DB = `./data/test-product-squad-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.DECISION_KG_ENABLED = "1";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  await import("../src/operations/skills");
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("product squad catalog", () => {
  it("lists nine product squad agents", async () => {
    const { PRODUCT_SQUAD_AGENTS } = await import("../src/operations/productSquadCatalog");
    expect(PRODUCT_SQUAD_AGENTS.length).toBe(9);
    expect(PRODUCT_SQUAD_AGENTS.find((a) => a.id === "orchestrator")?.ceoGate).toBe("product_launch");
  });
});

describe("PDLC orchestrator", () => {
  it("queues CEO launch gate on full PDLC run", async () => {
    const { runOperation, getWorkflow, listReviewsForActor } = await import("../src/operations/operationsWorkflow");
    const run = await runOperation(getWorkflow("pdlc-orchestrator")!, {
      product: "Collect",
      version: "2.0",
      summary: "Secondary marketplace refresh",
    });
    expect(run.outcome).toBe("queued");
    const ceoQueue = await listReviewsForActor("ceo");
    expect(ceoQueue.find((r) => r.id === run.reviewId)?.output_class).toBe("product_launch");
  });

  it("writes Product + Strategy + Launch nodes on CEO approve", async () => {
    const { runOperation, resolveReview, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const { exportGraph } = await import("../src/services/decisionGraphService");
    const ceo: AdminActor = { adminId: "ceo-1", role: "ceo" };

    const run = await runOperation(getWorkflow("pdlc-orchestrator")!, {
      product: "Invest",
      version: "1.5",
    });
    await resolveReview(run.reviewId!, ceo, "approve", "Launch approved");

    const graph = await exportGraph({ scope: "product", limit: 50 });
    expect(graph.nodes.some((n) => n.nodeType === "Product" && n.title === "Invest")).toBe(true);
    expect(graph.nodes.some((n) => n.nodeType === "Strategy")).toBe(true);
    expect(graph.nodes.some((n) => n.nodeType === "Launch")).toBe(true);
    expect(graph.edges.some((e) => e.edgeType === "resulted_in")).toBe(true);
  });

  it("product-strategy auto-executes with audit", async () => {
    const { runOperation, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const run = await runOperation(getWorkflow("product-strategy")!, { product: "Bank", summary: "Rails UX" });
    expect(run.outcome).toBe("executed");
  });
});

describe("support fix product KG", () => {
  it("records SupportIssue → Fix → Product on human approve", async () => {
    const { runOperation, resolveReview, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const { exportGraph } = await import("../src/services/decisionGraphService");
    const admin: AdminActor = { adminId: "admin-1", role: "admin" };

    const run = await runOperation(getWorkflow("product-support-fix")!, {
      product: "Agent",
      issue: "MFA countdown drifts on slow networks",
      fixSummary: "Sync countdown from server expiresAt",
    });
    expect(run.outcome).toBe("queued");
    await resolveReview(run.reviewId!, admin, "approve", "Fix verified");

    const graph = await exportGraph({ scope: "product", limit: 50 });
    expect(graph.nodes.some((n) => n.nodeType === "SupportIssue")).toBe(true);
    expect(graph.nodes.some((n) => n.nodeType === "Fix")).toBe(true);
    expect(graph.edges.filter((e) => e.edgeType === "resulted_in").length).toBeGreaterThan(0);
  });
});
