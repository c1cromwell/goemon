/**
 * Phase 15.3 — compliance reporting workflows on the operations runner.
 *
 *   - sanctions-rescreen: a clean screen auto-passes (audited, executed); a confirmed
 *     match escalates to compliance with a 10-day OFAC deadline + freeze recommendation,
 *     and a human approval freezes the account via the deterministic hold service.
 *   - compliance-filing: drafts SAR/OFAC/CTR and escalates with the right deadline;
 *     the human files (recorded), never the agent.
 *   - deadlines: due_at is set from the filing type; overdue listing surfaces breaches.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { runOperation, resolveReview, listOverdueReviews, getWorkflow, type WorkflowDef, type AdminActor } from "../src/operations/operationsWorkflow";
import { FILING_DEADLINE_HOURS } from "../src/operations/skills/complianceSkill";
import "../src/operations/skills";

const TMP_DB = `./data/test-compliance-${Date.now()}.db`;
const compliance: AdminActor = { adminId: "c-admin", role: "compliance" };
const support: AdminActor = { adminId: "c-support", role: "support" };
const ceo: AdminActor = { adminId: "c-ceo", role: "ceo" };

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

describe("sanctions-rescreen", () => {
  it("a clean screen auto-passes (audited)", async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(`san-ok-${Date.now()}@test.com`, "Clean Person");
    const res = await runOperation(def("sanctions-rescreen"), { userId: user.id, fullName: "Totally Clean" });
    expect(res.outcome).toBe("executed");
  });

  it("a confirmed match escalates to compliance (10d) and a human approval freezes", async () => {
    const { createUser } = await import("../src/services/authService");
    const { isAccountFrozen } = await import("../src/services/accountHoldService");
    const { getDb } = await import("../src/db");

    const user = await createUser(`san-hit-${Date.now()}@test.com`, "Blocked Person");
    const res = await runOperation(def("sanctions-rescreen"), { userId: user.id, fullName: "Blocked Person" });
    expect(res.outcome).toBe("queued");

    const review = await getDb().queryOne<{ due_at: string | null; recommendation: string }>(
      "SELECT due_at, recommendation FROM agent_reviews WHERE id = ?", [res.reviewId!]
    );
    expect(review!.due_at).toBeTruthy(); // 10-day OFAC deadline set
    expect(JSON.parse(review!.recommendation).recommendation).toBe("freeze_and_report");

    expect(await isAccountFrozen(user.id)).toBe(false);
    const resolved = await resolveReview(res.reviewId!, compliance, "approve");
    expect(resolved.outcome).toBe("executed");
    expect(await isAccountFrozen(user.id)).toBe(true); // frozen by the deterministic hold service
  });

  it("support cannot resolve a sanctions match (RBAC)", async () => {
    const { createUser } = await import("../src/services/authService");
    const { ErrorCode } = await import("../src/errors");
    const user = await createUser(`san-rbac-${Date.now()}@test.com`, "Sanctioned Entity");
    const res = await runOperation(def("sanctions-rescreen"), { userId: user.id, fullName: "Sanctioned Entity" });
    await expect(resolveReview(res.reviewId!, support, "approve")).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("compliance-filing", () => {
  it("drafts a SAR and escalates with a 30-day deadline; human files", async () => {
    const { getDb } = await import("../src/db");
    const res = await runOperation(def("compliance-filing"), { filingType: "SAR", subjectRef: "acct-1", summary: "structuring" });
    expect(res.outcome).toBe("queued");

    const review = await getDb().queryOne<{ due_at: string; recommendation: string }>(
      "SELECT due_at, recommendation FROM agent_reviews WHERE id = ?", [res.reviewId!]
    );
    const hoursUntilDue = (new Date(review!.due_at).getTime() - Date.now()) / 3_600_000;
    expect(Math.round(hoursUntilDue)).toBe(FILING_DEADLINE_HOURS.SAR); // ~720h
    expect(JSON.parse(review!.recommendation).filingType).toBe("SAR");

    const resolved = await resolveReview(res.reviewId!, ceo, "approve", "filed with FinCEN");
    expect(resolved.outcome).toBe("executed");
  });

  it("OFAC uses a 10-day deadline", async () => {
    const { getDb } = await import("../src/db");
    const res = await runOperation(def("compliance-filing"), { filingType: "OFAC", subjectRef: "acct-2" });
    const review = await getDb().queryOne<{ due_at: string }>("SELECT due_at FROM agent_reviews WHERE id = ?", [res.reviewId!]);
    const hours = Math.round((new Date(review!.due_at).getTime() - Date.now()) / 3_600_000);
    expect(hours).toBe(FILING_DEADLINE_HOURS.OFAC); // 240h
  });
});

describe("overdue SLA listing", () => {
  it("surfaces a review whose deadline has passed", async () => {
    const { getDb } = await import("../src/db");
    const res = await runOperation(def("compliance-filing"), { filingType: "CTR", subjectRef: "acct-3" });
    // Force the deadline into the past.
    await getDb().execute("UPDATE agent_reviews SET due_at = ? WHERE id = ?", ["2000-01-01T00:00:00.000Z", res.reviewId!]);
    const overdue = await listOverdueReviews();
    expect(overdue.some((r) => r.id === res.reviewId)).toBe(true);
  });
});
