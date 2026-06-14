/**
 * Phase 15.4 — Temporal worker for the operations runner.
 *
 * Registers the operations workflows + activities and polls the task queue. Runs as its
 * own process (separate from the API): `npm run temporal:worker`. The @temporalio/worker
 * SDK is lazy-required so the API process never loads the native core.
 *
 * Importing the skills registers their workflows in this process, so the activities
 * (which look workflows up by skill name) can find them.
 */

import { config } from "../../config";
import { logger } from "../../observability/logger";
import * as activities from "./activities";
import "../skills/kycReviewSkill"; // side effect: registerWorkflow(kyc-review)

export async function startOperationsWorker(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Worker, NativeConnection } = require("@temporalio/worker");
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("./workflow"),
    activities,
  });
  logger.info(
    { taskQueue: config.TEMPORAL_TASK_QUEUE, namespace: config.TEMPORAL_NAMESPACE },
    "Operations Temporal worker started"
  );
  await worker.run();
}

if (require.main === module) {
  startOperationsWorker().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[temporal:worker] failed:", err);
    process.exit(1);
  });
}
