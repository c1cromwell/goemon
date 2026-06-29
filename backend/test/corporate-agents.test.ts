/**
 * M5 — Corporate agent fleet (C-suite runner skills + Goeman Brain routing).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import type { AdminActor } from "../src/operations/operationsWorkflow";

const TMP_DB = `./data/test-corporate-agents-${Date.now()}.db`;

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

describe("corporate agent catalog", () => {
  it("lists eight C-suite agents including reused skills", async () => {
    const { CORPORATE_AGENTS } = await import("../src/operations/corporateAgentCatalog");
    expect(CORPORATE_AGENTS).toHaveLength(8);
    expect(CORPORATE_AGENTS.find((a) => a.id === "cfo")?.ceoGate).toBe("financial_output");
    expect(CORPORATE_AGENTS.find((a) => a.id === "cmo")?.reused).toBe(true);
  });

  it("resolveCorporateIntent maps financial intent to cfo-report", async () => {
    const { resolveCorporateIntent } = await import("../src/operations/corporateAgentCatalog");
    const route = resolveCorporateIntent("monthly treasury report");
    expect(route.targetSkill).toBe("cfo-report");
    expect(route.agentId).toBe("cfo");
  });
});

describe("corporate agent workflows", () => {
  it("CFO report queues for CEO financial gate", async () => {
    const { runOperation, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const def = getWorkflow("cfo-report");
    expect(def).toBeTruthy();
    const run = await runOperation(def!, { period: "monthly" });
    expect(run.outcome).toBe("queued");
    const { listReviewsForActor } = await import("../src/operations/operationsWorkflow");
    const ceoQueue = await listReviewsForActor("ceo");
    expect(ceoQueue.some((r) => r.id === run.reviewId)).toBe(true);
    expect(ceoQueue.find((r) => r.id === run.reviewId)?.output_class).toBe("financial_output");
  });

  it("CLO signoff queues for CEO legal gate", async () => {
    const { runOperation, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const run = await runOperation(getWorkflow("clo-signoff")!, { topic: "MSB posture" });
    expect(run.outcome).toBe("queued");
    const { listReviewsForActor } = await import("../src/operations/operationsWorkflow");
    const queue = await listReviewsForActor("ceo");
    expect(queue.find((r) => r.id === run.reviewId)?.output_class).toBe("legal_signoff");
  });

  it("CPO launch queues for CEO product launch gate", async () => {
    const { runOperation, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const run = await runOperation(getWorkflow("cpo-launch")!, { product: "Collect", version: "2.0" });
    expect(run.outcome).toBe("queued");
    const { listReviewsForActor } = await import("../src/operations/operationsWorkflow");
    const queue = await listReviewsForActor("ceo");
    expect(queue.find((r) => r.id === run.reviewId)?.output_class).toBe("product_launch");
  });

  it("CISO posture auto-executes with audit", async () => {
    const { runOperation, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const run = await runOperation(getWorkflow("ciso-posture")!, { scope: "corporate" });
    expect(run.outcome).toBe("executed");
  });

  it("Goeman Brain routes launch intent after CEO approves routing", async () => {
    const { runOperation, resolveReview, getWorkflow } = await import("../src/operations/operationsWorkflow");
    const ceo: AdminActor = { adminId: "ceo-1", role: "ceo" };

    const brainRun = await runOperation(getWorkflow("goeman-brain-route")!, {
      intent: "ship Collect v2 to production",
      payload: { product: "Collect", version: "2.0" },
    });
    expect(brainRun.outcome).toBe("queued");

    const resolved = await resolveReview(brainRun.reviewId!, ceo, "approve", "Route approved");
    expect(resolved.outcome).toBe("executed");

    const { getDb } = await import("../src/db");
    const cpoReviews = await getDb().query<{ output_class: string | null; skill: string }>(
      "SELECT output_class, skill FROM agent_reviews WHERE skill = 'cpo-launch' ORDER BY created_at DESC LIMIT 1"
    );
    expect(cpoReviews[0]?.skill).toBe("cpo-launch");
    expect(cpoReviews[0]?.output_class).toBe("product_launch");
  });
});
