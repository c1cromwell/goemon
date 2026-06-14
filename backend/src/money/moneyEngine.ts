/**
 * Phase 20 — money-path orchestration entry point.
 *
 * executeTransfer() is what the API/SmartChat/MCP call instead of transferService.transfer
 * directly. When TEMPORAL_MONEY_ENABLED it runs the transfer as a durable Temporal
 * workflow (exactly-once at the ledger via the idempotency key); otherwise — or if the
 * Temporal SDK/server is unavailable — it calls the ledger transfer directly. Behavior is
 * identical either way because the ledger is the single source of truth; Temporal only
 * adds durability, retries, and visibility. Never fails open: any orchestration error
 * degrades to the direct path.
 */

import { config } from "../config";
import { logger } from "../observability/logger";
import { transfer, type TransferInput, type TransferResult } from "../services/transferService";
import type { TransferWire } from "./moneyActivities";

const MONEY_WORKFLOW = "moneyTransferWorkflow";

function toWire(input: TransferInput): TransferWire {
  return {
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amountMinor: input.amountMinor.toString(), // bigint → decimal string (no floats over the wire)
    currency: input.currency,
    description: input.description,
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
  };
}

async function runViaTemporal(input: TransferInput): Promise<TransferResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const temporal = require("@temporalio/client");
  const connection = await temporal.Connection.connect({ address: config.TEMPORAL_ADDRESS, connectTimeout: "2s" });
  const client = new temporal.Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  try {
    // workflowId keyed on the idempotency key → Temporal also dedupes duplicate
    // submissions, and the ledger idempotency makes the activity itself exactly-once.
    const handle = await client.workflow.start(MONEY_WORKFLOW, {
      taskQueue: config.TEMPORAL_MONEY_TASK_QUEUE,
      workflowId: `money-transfer-${input.idempotencyKey}`,
      args: [toWire(input)],
    });
    return (await handle.result()) as TransferResult;
  } catch (e) {
    // A duplicate workflowId means this transfer is already running/complete — fetch it.
    const msg = (e as Error).message ?? "";
    if (/already started|WorkflowExecutionAlreadyStarted/i.test(msg)) {
      const handle = client.workflow.getHandle(`money-transfer-${input.idempotencyKey}`);
      return (await handle.result()) as TransferResult;
    }
    throw e;
  } finally {
    await connection.close();
  }
}

/** Run a transfer through Temporal when enabled, else directly. Degrades to direct. */
export async function executeTransfer(input: TransferInput): Promise<TransferResult> {
  if (!config.TEMPORAL_MONEY_ENABLED) {
    return transfer(input);
  }
  try {
    return await runViaTemporal(input);
  } catch (e) {
    logger.warn({ err: (e as Error).message, idempotencyKey: input.idempotencyKey }, "Temporal money path failed; running transfer directly");
    return transfer(input);
  }
}
