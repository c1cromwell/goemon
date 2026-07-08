/**
 * M4 / M4.1 — Model router (multi-vendor routing, pinning, fallback).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "fs";

const TMP_DB = `./data/test-model-router-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.MODEL_ROUTER_ENABLED = "1";
  process.env.MODEL_ROUTER_COMPLIANCE_ANTHROPIC_ONLY = "1";
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
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

describe("model router", () => {
  it("routes kyc_review to standard tier (Sonnet-class)", async () => {
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("kyc_review");
    expect(chain[0]?.id).toBe("claude-sonnet-4");
    expect(chain[0]?.tier).toBe("standard");
  });

  it("pins kyc_review to anthropic vendors only", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.CURSOR_API_KEY = "test-cursor";
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("kyc_review");
    expect(chain.every((m) => m.vendor === "anthropic")).toBe(true);
    delete process.env.OPENAI_API_KEY;
    delete process.env.CURSOR_API_KEY;
  });

  it("prefers cursor for code_review when configured", async () => {
    process.env.CURSOR_API_KEY = "test-cursor";
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const { cursorSdkInstalled } = await import("../src/operations/modelRouter/vendorConfig");
    if (!cursorSdkInstalled()) {
      return; // @cursor/sdk optional — skip when not installed
    }
    const chain = selectModels("code_review");
    expect(chain[0]?.vendor).toBe("cursor");
    delete process.env.CURSOR_API_KEY;
  });

  it("routes legal_draft to high tier (Opus-class) with fallback chain", async () => {
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("legal_draft");
    expect(chain[0]?.id).toBe("claude-opus-4");
    expect(chain.some((m) => m.id === "claude-sonnet-4")).toBe(true);
  });

  it("routing preview covers all task classes", async () => {
    const { routingPreview } = await import("../src/operations/modelRouter/registry");
    const preview = routingPreview();
    expect(preview.length).toBeGreaterThanOrEqual(8);
    expect(preview.find((p) => p.taskClass === "triage")?.tier).toBe("fast");
  });

  it("routes the marketing_draft pilot task to chutes when configured, with anthropic fallback", async () => {
    process.env.CHUTES_API_KEY = "test-chutes";
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("marketing_draft");
    expect(chain[0]?.vendor).toBe("chutes");
    // Anthropic/OpenAI must remain in the chain as the guaranteed fallback.
    expect(chain.some((m) => m.vendor === "anthropic")).toBe(true);
    delete process.env.CHUTES_API_KEY;
  });

  it("NEVER routes chutes to a compliance-pinned task, even when configured", async () => {
    process.env.CHUTES_API_KEY = "test-chutes";
    process.env.OPENAI_API_KEY = "test-openai";
    const { selectModels } = await import("../src/operations/modelRouter/router");
    for (const task of ["kyc_review", "compliance_analysis", "legal_draft", "launch_decision"] as const) {
      const chain = selectModels(task);
      expect(chain.every((m) => m.vendor === "anthropic")).toBe(true);
      expect(chain.some((m) => m.vendor === "chutes")).toBe(false);
    }
    // And chutes must not leak into non-pilot general tasks either.
    expect(selectModels("summary").some((m) => m.vendor === "chutes")).toBe(false);
    delete process.env.CHUTES_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("falls back to anthropic for marketing_draft when chutes is unconfigured", async () => {
    delete process.env.CHUTES_API_KEY;
    const { selectModels } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("marketing_draft");
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.every((m) => m.vendor !== "chutes")).toBe(true);
    expect(chain[0]?.vendor).toBe("anthropic");
  });

  it("falls back across vendors on provider error", async () => {
    vi.resetModules();
    vi.doMock("../src/operations/modelRouter/providers", () => ({
      invokeProvider: vi
        .fn()
        .mockRejectedValueOnce(new Error("openai down"))
        .mockResolvedValueOnce({
          modelId: "claude-haiku-4",
          vendor: "anthropic",
          tier: "fast",
          raw: { content: [] },
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
          costMicroUsd: 1,
        }),
    }));
    process.env.OPENAI_API_KEY = "test-openai";
    const { selectModels, invokeModel } = await import("../src/operations/modelRouter/router");
    const chain = selectModels("summary");
    expect(chain.some((m) => m.vendor === "openai")).toBe(true);
    const result = await invokeModel({
      taskClass: "summary",
      skill: "test",
      system: "s",
      userContent: "u",
      maxTokens: 8,
    });
    expect(result.vendor).toBe("anthropic");
    vi.doUnmock("../src/operations/modelRouter/providers");
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
  });

  it("logs error invocation when all providers fail", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CURSOR_API_KEY;
    vi.resetModules();
    const { invokeModel, listInvocations } = await import("../src/operations/modelRouter/router");
    await expect(
      invokeModel({
        taskClass: "summary",
        skill: "test-skill",
        system: "test",
        userContent: "{}",
        maxTokens: 16,
      })
    ).rejects.toThrow();
    const rows = await listInvocations(5);
    expect(rows.some((r) => r.status === "error" && r.taskClass === "summary")).toBe(true);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
    vi.resetModules();
  });

  it("model_invocations is append-only", async () => {
    const { getDb } = await import("../src/db");
    const db = getDb();
    await db.execute(
      `INSERT INTO model_invocations
         (id, task_class, model_id, vendor, input_tokens, output_tokens, cost_micro_usd, latency_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["inv-test-1", "general", "claude-haiku-4", "anthropic", 10, 5, 100, 50, "ok", new Date().toISOString()]
    );
    await expect(
      db.execute("UPDATE model_invocations SET status = 'bad' WHERE id = ?", ["inv-test-1"])
    ).rejects.toThrow(/append-only/i);
  });
});
