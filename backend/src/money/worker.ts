/**
 * Phase 20 — money-path Temporal worker.
 *
 * Registers the money workflow + activities and polls the money task queue. Runs as its
 * own process (separate queue from agent ops): `npm run money:worker`. @temporalio/worker
 * is lazy-required so the API process never loads the native core.
 */

import { config } from "../config";
import { logger } from "../observability/logger";
import * as activities from "./moneyActivities";

export async function startMoneyWorker(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Worker, NativeConnection } = require("@temporalio/worker");
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_MONEY_TASK_QUEUE,
    workflowsPath: require.resolve("./moneyWorkflow"),
    activities,
  });
  logger.info({ taskQueue: config.TEMPORAL_MONEY_TASK_QUEUE }, "Money Temporal worker started");
  await worker.run();
}

if (require.main === module) {
  startMoneyWorker().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[money:worker] failed:", err);
    process.exit(1);
  });
}
