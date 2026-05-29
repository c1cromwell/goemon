/**
 * Phase 5A — Agentic account opening (risk-adaptive identity).
 *
 * Covers the orchestrator decision policy, dynamic sub-agent spawning, the PII-safety
 * invariant, the advisory-vs-guardrail invariant, simulated identity isolation, and RBAC.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { NextFunction } from "express";

const TMP_DB = `./data/test-phase5a-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TMP_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
}

beforeAll(setup);

/** Drive an Express middleware once and resolve with the error it passed to next(), if any. */
function runMiddleware(mw: (req: unknown, res: unknown, next: NextFunction) => void, req: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    mw(req, {}, ((err?: unknown) => resolve(err ?? null)) as NextFunction);
  });
}

function fakeReq(authHeader?: string) {
  return {
    header: (k: string) => (k.toLowerCase() === "authorization" && authHeader ? authHeader : undefined),
  };
}

// ---------------------------------------------------------------------------
// Decision policy (pure)
// ---------------------------------------------------------------------------

describe("Phase 5A: finalizeDecision guardrails", () => {
  it("a single very-weak signal blocks auto-approval even at high model confidence", async () => {
    const { finalizeDecision } = await import("../src/services/riskOrchestratorService");
    const result = finalizeDecision({
      confidence: 0.95, // advisory model is very confident…
      summary: {
        email_score: 0.1, // …but one signal is very weak
        ip_score: 0.9,
        device_score: 0.9,
        behavior_score: 0.9,
        email_category: "disposable",
        ip_category: "residential",
        device_reuse: false,
        rapid_completion: false,
      },
      pendingSteps: [],
      failedSteps: [],
      sanctionsBlocked: false,
    });
    expect(result.decision).toBe("manual_review");
    expect(result.status).toBe("review_required");
  });

  it("a sanctions hit hard-rejects regardless of confidence", async () => {
    const { finalizeDecision } = await import("../src/services/riskOrchestratorService");
    const result = finalizeDecision({
      confidence: 0.99,
      summary: {
        email_score: 0.9,
        ip_score: 0.9,
        device_score: 0.9,
        behavior_score: 0.9,
        email_category: "corporate",
        ip_category: "residential",
        device_reuse: false,
        rapid_completion: false,
      },
      pendingSteps: [],
      failedSteps: [],
      sanctionsBlocked: true,
    });
    expect(result.decision).toBe("reject");
  });
});

// ---------------------------------------------------------------------------
// Orchestrated flow
// ---------------------------------------------------------------------------

describe("Phase 5A: risk-adaptive onboarding flow", () => {
  it("clean signals auto-approve to Tier 2 with no sub-agents spawned", async () => {
    const { createUser } = await import("../src/services/authService");
    const { startOnboarding } = await import("../src/services/riskOrchestratorService");
    const { getProfile } = await import("../src/services/identityService");

    const user = await createUser("clean@acme-corp.example", "Clean User");
    const view = await startOnboarding(user.id, {
      email: user.email,
      ip: "192.168.1.10",
      deviceFingerprint: "fp-clean",
      rapidCompletion: false,
    });

    expect(view.status).toBe("approved");
    expect(view.decision).toBe("auto_approve");
    expect(view.required_steps).toEqual([]);
    // Only the orchestrator's own run is recorded — no document/possession sub-agent.
    expect(view.agent_runs.map((r) => r.agent_type)).toEqual(["risk_orchestrator"]);

    const profile = await getProfile(user.id);
    expect(profile?.tier).toBe(2);
  });

  it("bot-like timing dynamically spawns the possession sub-agent; passing it approves", async () => {
    const { createUser } = await import("../src/services/authService");
    const { startOnboarding, submitPossession } = await import("../src/services/riskOrchestratorService");

    const user = await createUser("rapid@gmail.com", "Rapid User");
    const start = await startOnboarding(user.id, {
      email: user.email,
      ip: "192.168.1.11",
      deviceFingerprint: "fp-rapid",
      rapidCompletion: true,
    });
    expect(start.status).toBe("awaiting_verification");
    expect(start.required_steps).toContain("possession_check");

    const done = await submitPossession(user.id, { code: "123456" });
    expect(done.status).toBe("approved");
    expect(done.agent_runs.some((r) => r.agent_type === "possession_check" && r.status === "passed")).toBe(true);
  });

  it("a tampered document fails the document sub-agent → manual review", async () => {
    const { createUser } = await import("../src/services/authService");
    const { startOnboarding, submitDocument } = await import("../src/services/riskOrchestratorService");

    const user = await createUser("datacenter@gmail.com", "Datacenter User");
    const start = await startOnboarding(user.id, {
      email: user.email,
      ip: "203.0.113.7", // datacenter → weak IP signal → document required
      deviceFingerprint: "fp-dc",
      rapidCompletion: false,
    });
    expect(start.required_steps).toContain("document_validation");

    const done = await submitDocument(user.id, { documentNumber: "2", fullName: "Datacenter User" });
    expect(done.status).toBe("review_required");
    expect(done.decision).toBe("manual_review");
  });
});

// ---------------------------------------------------------------------------
// PII-safety invariant
// ---------------------------------------------------------------------------

describe("Phase 5A: PII minimization", () => {
  it("the persisted signal summary contains scores/flags only — no raw email or IP", async () => {
    const { createUser } = await import("../src/services/authService");
    const { startOnboarding } = await import("../src/services/riskOrchestratorService");
    const { getDb } = await import("../src/db");

    const email = "pii-check@acme-corp.example";
    const ip = "203.0.113.55";
    const user = await createUser(email, "Pii Check");
    const view = await startOnboarding(user.id, { email, ip, deviceFingerprint: "fp-pii", rapidCompletion: false });

    const row = await getDb().queryOne<{ signals_json: string }>(
      "SELECT signals_json FROM onboarding_sessions WHERE id = ?",
      [view.id]
    );
    const blob = row!.signals_json;
    expect(blob).not.toContain(email);
    expect(blob).not.toContain(ip);
    // Only the minimized summary keys are present.
    expect(Object.keys(JSON.parse(blob)).sort()).toEqual(
      [
        "behavior_score",
        "device_reuse",
        "device_score",
        "email_category",
        "email_score",
        "ip_category",
        "ip_score",
        "rapid_completion",
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Simulated identities
// ---------------------------------------------------------------------------

describe("Phase 5A: simulated identities", () => {
  it("generate distinct risk profiles, flagged is_simulated, without touching real users", async () => {
    const { createUser } = await import("../src/services/authService");
    const { createSimulatedIdentities, listIdentities } = await import("../src/services/adminService");
    const { getDb } = await import("../src/db");

    const real = await createUser("real-untouched@acme-corp.example", "Real User");

    const results = await createSimulatedIdentities(["low", "medium", "high", "review", "reject"]);
    for (const r of results) {
      expect(r.decision).toBe(r.expected);
    }

    const identities = await listIdentities();
    const sims = identities.filter((i) => i.is_simulated);
    expect(sims.length).toBeGreaterThanOrEqual(5);

    // The pre-existing real user is present and NOT flagged simulated.
    const realRow = identities.find((i) => i.user_id === real.id);
    expect(realRow).toBeTruthy();
    expect(realRow!.is_simulated).toBe(false);

    const flag = await getDb().queryOne<{ is_simulated: number }>(
      "SELECT is_simulated FROM users WHERE id = ?",
      [real.id]
    );
    expect(flag!.is_simulated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

describe("Phase 5A: admin RBAC", () => {
  it("seed + authenticate; wrong password is rejected", async () => {
    const { seedAdmin, authenticateAdmin } = await import("../src/services/adminService");
    const seeded = await seedAdmin();
    expect(seeded.email).toBe("admin@bankai.com");

    const ok = await authenticateAdmin("admin@bankai.com", "Admin1234!");
    expect(ok.role).toBe("admin");

    await expect(authenticateAdmin("admin@bankai.com", "wrong")).rejects.toThrow();
  });

  it("requireAdmin rejects missing and non-admin (user) tokens; accepts admin tokens", async () => {
    const { requireAdmin, signAdminSession } = await import("../src/middleware/rbac");
    const { signSession } = await import("../src/middleware/auth");

    const noToken = (await runMiddleware(requireAdmin as never, fakeReq())) as { code?: string } | null;
    expect(noToken && noToken.code).toBe("UNAUTHENTICATED");

    const userToken = signSession("user-123");
    const asUser = (await runMiddleware(requireAdmin as never, fakeReq(`Bearer ${userToken}`))) as { code?: string };
    expect(asUser.code).toBe("FORBIDDEN"); // valid signature in dev, but no kind:"admin"

    const adminToken = signAdminSession("admin-1", "admin");
    const req = fakeReq(`Bearer ${adminToken}`) as Record<string, unknown>;
    const accepted = await runMiddleware(requireAdmin as never, req);
    expect(accepted).toBeNull();
    expect(req.adminId).toBe("admin-1");
    expect(req.adminRole).toBe("admin");
  });

  it("requireRole enforces the allow-list", async () => {
    const { requireRole } = await import("../src/middleware/rbac");
    const mw = requireRole("compliance", "admin");

    const support = (await runMiddleware(mw as never, { adminRole: "support" })) as { code?: string };
    expect(support.code).toBe("FORBIDDEN");

    const compliance = await runMiddleware(mw as never, { adminRole: "compliance" });
    expect(compliance).toBeNull();
  });
});
