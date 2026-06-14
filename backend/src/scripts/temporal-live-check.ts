/**
 * Phase 15.4 — LIVE Temporal end-to-end check.
 *
 * Runs the KYC-review operations workflow against a REAL Temporal server (not the
 * in-process fallback). Single process: opens the DB, starts an in-process Temporal
 * Worker (registers the operations workflows + activities), then uses a Temporal Client
 * to drive runOperationWorkflow + resolveReviewWorkflow and asserts the user reaches
 * Tier 2 — proving the durable orchestration actually executed our activities.
 *
 * Prereqs: a Temporal server on TEMPORAL_ADDRESS (default localhost:7233), e.g.
 *   docker compose -f docker-compose.temporal.yml up -d
 * Run: npm run temporal:live-check
 */
process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/temporal-live.db";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "temporal_live_check_secret_at_least_32_chars";
process.env.TEMPORAL_ENABLED = "true";

import { Worker } from "@temporalio/worker";
import { Connection, Client } from "@temporalio/client";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db";
import { initKeyVault } from "../services/keyVaultService";
import { initTokenFactory } from "../utils/tokenFactory";
import { createUser } from "../services/authService";
import { getProfile } from "../services/identityService";
import * as activities from "../operations/temporal/activities";
import "../operations/skills/kycReviewSkill"; // register the kyc-review workflow

async function main(): Promise<void> {
  await runMigrations();
  initKeyVault();
  await initTokenFactory();

  const worker = await Worker.create({
    connection: undefined, // default localhost:7233 (Worker uses NativeConnection internally)
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("../operations/temporal/workflow"),
    activities,
  });

  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });

  // runUntil starts the worker, runs our driver, then shuts the worker down.
  await worker.runUntil(async () => {
    const user = await createUser(`tlive-${Date.now()}@test.com`, "Clean Applicant");

    const runHandle = await client.workflow.start("runOperationWorkflow", {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `op-kyc-${uuidv4()}`,
      args: ["kyc-review", { userId: user.id, fullName: "Clean Applicant", documentNumber: "DOC-LIVE" }],
    });
    const runResult = (await runHandle.result()) as { outcome: string; reviewId?: string };
    console.log(`[live] runOperationWorkflow -> ${runResult.outcome} (review ${runResult.reviewId})`);
    if (runResult.outcome !== "queued" || !runResult.reviewId) throw new Error("expected queued with a reviewId");

    const resolveHandle = await client.workflow.start("resolveReviewWorkflow", {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `resolve-${uuidv4()}`,
      args: [runResult.reviewId, { adminId: "live-admin", role: "compliance" }, "approve", "live check"],
    });
    const resolveResult = (await resolveHandle.result()) as { outcome: string };
    console.log(`[live] resolveReviewWorkflow -> ${resolveResult.outcome}`);
    if (resolveResult.outcome !== "executed") throw new Error("expected executed");

    const profile = await getProfile(user.id);
    if (profile?.tier !== 2) throw new Error(`expected Tier 2, got ${profile?.tier}`);
    console.log(`[live] PASS — user ${user.id} granted Tier ${profile.tier} via live Temporal`);
  });

  await connection.close();
  await closeDb();
}

main().catch((err) => {
  console.error("[temporal:live-check] FAILED:", err);
  process.exit(1);
});
