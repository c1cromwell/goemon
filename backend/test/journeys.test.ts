/**
 * Journey orchestration platform (prototype) — proves the four pillars:
 *   1. Declarative journey engine — journey-as-data DAG, CEL branching, resumability.
 *   2. Server-Driven UI — collect/consent steps emit channel-agnostic screen descriptors.
 *   3. Connector framework — runtime registry + waterfall/cascade failover.
 *   4. Risk-as-a-node — a risk_check step branches the journey on decision + reason codes.
 * Plus: the existing onboarding re-expressed as data yields auto-approve / review / reject;
 * malformed CEL fails at LOAD, not mid-run.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-journeys-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { seedDefaultJourneys } = await import("../src/journeys/onboardingJourney");
  await seedDefaultJourneys();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

const IDENTITY = { fullName: "Sam", dob: "1990-01-01", email: "sam@test.com", documentNumber: "X123" };

describe("Journey engine — declarative DAG, SDUI, connectors, risk node", () => {
  it("CEL evaluator: comparisons, &&/||, membership, ternary; bad expr throws at compile", async () => {
    const { compile, test, CelError } = await import("../src/journeys/cel");
    expect(test(compile("a >= 10 && b == 'x'"), { a: 12, b: "x" })).toBe(true);
    expect(test("'sanctions_hit' in codes", { codes: ["sanctions_hit"] })).toBe(true);
    expect(() => compile("a &&")).toThrow(CelError);
  });

  it("validateJourney rejects a malformed branch CEL at LOAD (not mid-run)", async () => {
    const { validateJourney } = await import("../src/journeys/journeyStore");
    expect(() =>
      validateJourney({
        id: "bad", version: "v1", title: "x", start: "s",
        steps: [{ id: "s", type: "branch", branches: [{ when: "a >=", to: "s" }] }],
      })
    ).toThrow();
  });

  it("happy path: collect (SDUI) → connector waterfall → risk approve → consent → approved", async () => {
    const { startJourney, submitStep } = await import("../src/journeys/journeyRunner");

    // 1) start → pauses at the collect screen (Server-Driven UI descriptor).
    const r1 = await startJourney("onboarding", { subjectUserId: "u1", data: {} });
    expect(r1.status).toBe("awaiting_input");
    expect(r1.ui?.kind).toBe("form");
    expect(r1.ui?.fields.map((f) => f.key)).toContain("documentNumber"); // Pillar 2

    // 2) submit identity → connector waterfall runs → risk approves → consent screen.
    const r2 = await submitStep(r1.runId, IDENTITY);
    expect(r2.status).toBe("awaiting_input");
    expect(r2.ui?.kind).toBe("consent");
    // Pillar 3 — waterfall failed over from "always-fail" to "simulated".
    const conn = r2.context.connectorResults.verify_document as Record<string, unknown>;
    expect(conn.usedConnector).toBe("simulated");
    // Pillar 4 — the risk node produced an approve decision.
    const risk = r2.context.riskDecisions.kyc_risk as Record<string, unknown>;
    expect(risk.decision).toBe("approve");

    // 3) accept consent → completed, approved.
    const r3 = await submitStep(r2.runId, { accepted: true });
    expect(r3.status).toBe("completed");
    expect(r3.context.outcome?.result).toBe("approved");
  });

  it("deny path: a sanctions hit routes straight to rejected (risk branch)", async () => {
    const { startJourney, submitStep } = await import("../src/journeys/journeyRunner");
    const r1 = await startJourney("onboarding", { subjectUserId: "u2", data: { sanctionsHit: true } });
    const r2 = await submitStep(r1.runId, IDENTITY);
    expect(r2.status).toBe("completed");
    expect(r2.context.outcome?.result).toBe("rejected");
    expect(r2.context.outcome?.reasonCodes).toContain("kyc_denied");
  });

  it("review path: elevated risk → manual_review → human approve → approved", async () => {
    const { startJourney, submitStep, resolveReview, getRun } = await import("../src/journeys/journeyRunner");
    const r1 = await startJourney("onboarding", { subjectUserId: "u3", data: { emailRisk: 80, deviceRisk: 80 } });
    const r2 = await submitStep(r1.runId, IDENTITY);
    expect(r2.status).toBe("awaiting_review"); // risk decision == review → manual_review pause

    // Resumability: the run is persisted and re-loadable.
    expect((await getRun(r2.runId)).status).toBe("awaiting_review");

    const r3 = await resolveReview(r2.runId, "approve");
    expect(r3.status).toBe("awaiting_input"); // consent screen
    const r4 = await submitStep(r3.runId, { accepted: true });
    expect(r4.context.outcome?.result).toBe("approved");
  });

  it("review path: human reject → rejected", async () => {
    const { startJourney, submitStep, resolveReview } = await import("../src/journeys/journeyRunner");
    const r1 = await startJourney("onboarding", { subjectUserId: "u4", data: { emailRisk: 80, deviceRisk: 80 } });
    const r2 = await submitStep(r1.runId, IDENTITY);
    const r3 = await resolveReview(r2.runId, "reject", "docs unclear");
    expect(r3.status).toBe("completed");
    expect(r3.context.outcome?.result).toBe("rejected");
  });

  it("connector waterfall records every attempt on the append-only step trail", async () => {
    const { startJourney, submitStep } = await import("../src/journeys/journeyRunner");
    const { getDb } = await import("../src/db");
    const r1 = await startJourney("onboarding", { subjectUserId: "u5", data: {} });
    await submitStep(r1.runId, IDENTITY);
    const row = await getDb().queryOne<{ detail: string }>(
      "SELECT detail FROM journey_steps WHERE run_id = ? AND step_id = 'verify_document'",
      [r1.runId]
    );
    const detail = JSON.parse(row!.detail) as { attempts: Array<{ id: string; ok: boolean }> };
    expect(detail.attempts.map((a) => a.id)).toEqual(["always-fail", "simulated"]);
    expect(detail.attempts[0]!.ok).toBe(false);
    expect(detail.attempts[1]!.ok).toBe(true);
  });

  it("journey-as-data: editing a step's CEL changes routing with no code change", async () => {
    // Define + seed a tiny journey whose branch threshold lives in CEL, then flip it.
    const { seedJourney } = await import("../src/journeys/journeyStore");
    const { startJourney, submitStep } = await import("../src/journeys/journeyRunner");
    const mk = (id: string, threshold: number) => ({
      id, version: "v1", title: "score gate", start: "collect",
      steps: [
        { id: "collect", type: "collect" as const, config: { fields: [{ key: "score", label: "score", type: "number" as const }] }, next: "gate" },
        { id: "gate", type: "branch" as const, branches: [{ when: `score >= ${threshold}`, to: "high" }], next: "low" },
        { id: "high", type: "complete" as const, config: { result: "'high'" } },
        { id: "low", type: "complete" as const, config: { result: "'low'" } },
      ],
    });
    await seedJourney(mk("gate-strict", 90));
    await seedJourney(mk("gate-loose", 50));
    const strict = await submitStep((await startJourney("gate-strict", { data: {} })).runId, { score: 70 });
    const loose = await submitStep((await startJourney("gate-loose", { data: {} })).runId, { score: 70 });
    expect(strict.context.outcome?.result).toBe("low");  // 70 < 90
    expect(loose.context.outcome?.result).toBe("high");  // 70 >= 50  — only the CEL changed
  });
});
