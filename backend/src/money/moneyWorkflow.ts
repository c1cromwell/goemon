/**
 * Phase 20 — money-path Temporal workflow (durable orchestration shell).
 *
 * NOTE: runs in Temporal's deterministic sandbox; bundled by the Temporal tooling, NOT
 * compiled by the API tsc (tsconfig "exclude"). Imports only @temporalio/workflow and
 * calls the money activity via proxy. The activity is idempotent at the ledger, so the
 * default retry policy is safe (a retried transfer re-posts nothing).
 *
 * This is the seam for future multi-step money sagas (e.g. ledger debit → on-chain
 * settle → reconcile); today it durably wraps the single exactly-once ledger transfer.
 */

import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./moneyActivities";

const { transferActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5 },
});

export async function moneyTransferWorkflow(wire: activities.TransferWire) {
  return transferActivity(wire);
}
