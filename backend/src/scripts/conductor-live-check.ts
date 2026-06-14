/**
 * Phase 15.4 — LIVE Conductor end-to-end check.
 *
 * Drives the KYC-review operation through a REAL Conductor server (not the in-process
 * fallback). Single process: opens the DB, registers the defs, starts the Conductor
 * task worker (polling), then uses the ConductorEngine to run operation_workflow +
 * resolve_workflow and asserts the user reaches Tier 2 — proving the task worker
 * executed our activities under Conductor's orchestration.
 *
 * Prereqs: a Conductor server on CONDUCTOR_URL (default http://localhost:8080/api), e.g.
 *   docker compose -f docker-compose.conductor.yml up -d   (wait ~1 min for ES)
 * Run: npm run conductor:live-check
 */
process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/conductor-live.db";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "conductor_live_check_secret_at_least_32_chars";
process.env.CONDUCTOR_ENABLED = "true";

import { runMigrations } from "../db/migrate";
import { closeDb } from "../db";
import { initKeyVault } from "../services/keyVaultService";
import { initTokenFactory } from "../utils/tokenFactory";
import { createUser } from "../services/authService";
import { getProfile } from "../services/identityService";
import { createConductorEngine } from "../operations/conductor/conductorEngine";
import { startOperationsConductorWorker } from "../operations/conductor/worker";
import { kycReviewWorkflow } from "../operations/skills/kycReviewSkill";
import type { WorkflowDef } from "../operations/operationsWorkflow";

async function main(): Promise<void> {
  await runMigrations();
  initKeyVault();
  await initTokenFactory();

  const worker = (await startOperationsConductorWorker()) as { stopPolling: () => void };
  const engine = createConductorEngine();
  try {
    const user = await createUser(`clive-${Date.now()}@test.com`, "Clean Applicant");

    const run = await engine.execute(kycReviewWorkflow as WorkflowDef, {
      userId: user.id, fullName: "Clean Applicant", documentNumber: "DOC-LIVE",
    });
    console.log(`[live] operation_workflow -> ${run.outcome} (review ${run.reviewId})`);
    if (run.outcome !== "queued" || !run.reviewId) throw new Error("expected queued with a reviewId");

    const resolved = await engine.resolve(run.reviewId, { adminId: "live-admin", role: "compliance" }, "approve", "live check");
    console.log(`[live] resolve_workflow -> ${resolved.outcome}`);
    if (resolved.outcome !== "executed") throw new Error("expected executed");

    const profile = await getProfile(user.id);
    if (profile?.tier !== 2) throw new Error(`expected Tier 2, got ${profile?.tier}`);
    console.log(`[live] PASS — user ${user.id} granted Tier ${profile.tier} via live Conductor`);
  } finally {
    worker.stopPolling();
    await closeDb();
  }
}

main().catch((err) => {
  console.error("[conductor:live-check] FAILED:", err);
  process.exit(1);
});
