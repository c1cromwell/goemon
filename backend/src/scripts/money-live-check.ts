/**
 * Phase 20 — LIVE money-path Temporal check.
 *
 * Runs a real transfer through a real Temporal server: opens the DB, starts an in-process
 * money worker, then calls executeTransfer (TEMPORAL_MONEY_ENABLED) and asserts the funds
 * moved on the ledger. Re-runs with the same idempotency key to prove exactly-once (no
 * double-post) under orchestration.
 *
 * Prereqs: a Temporal server on TEMPORAL_ADDRESS (docker compose -f docker-compose.temporal.yml up -d).
 * Run: npm run money:live-check
 */
process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/money-live.db";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "money_live_check_secret_at_least_32_chars";
process.env.TEMPORAL_MONEY_ENABLED = "true";

import { Worker } from "@temporalio/worker";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db";
import { createUser } from "../services/authService";
import { getBalance, getOrCreateUserAccount } from "../services/ledgerService";
import { executeTransfer } from "../money/moneyEngine";
import * as activities from "../money/moneyActivities";

async function main(): Promise<void> {
  await runMigrations();

  const worker = await Worker.create({
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_MONEY_TASK_QUEUE,
    workflowsPath: require.resolve("../money/moneyWorkflow"),
    activities,
  });

  await worker.runUntil(async () => {
    const alice = await createUser(`money-a-${Date.now()}@test.com`, "Alice"); // $10,000 opening balance
    const bob = await createUser(`money-b-${Date.now()}@test.com`, "Bob");
    const aliceAcct = await getOrCreateUserAccount(alice.id, "user_cash", "USD");
    const key = `live-${uuidv4()}`;

    const r1 = await executeTransfer({
      fromUserId: alice.id, toUserId: bob.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key, channel: "api",
    });
    console.log(`[live] transfer via Temporal -> journal ${r1.journalId}`);

    // Replay with the same key — must collapse onto the same journal (exactly-once).
    const r2 = await executeTransfer({
      fromUserId: alice.id, toUserId: bob.id, amountMinor: 2500n, currency: "USD", idempotencyKey: key, channel: "api",
    });
    if (r1.journalId !== r2.journalId) throw new Error("exactly-once violated: different journals");

    const aliceBal = await getBalance(aliceAcct);
    if (aliceBal !== 1_000_000n - 2500n) throw new Error(`unexpected balance ${aliceBal} (expected ${1_000_000n - 2500n})`);
    console.log(`[live] PASS — exactly-once transfer through live Temporal; Alice balance ${aliceBal}`);
  });

  await closeDb();
}

main().catch((err) => {
  console.error("[money:live-check] FAILED:", err);
  process.exit(1);
});
