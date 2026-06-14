/**
 * Phase 15.4 — Temporal-backed WorkflowEngine (optional, lazy, degrades gracefully).
 *
 * When TEMPORAL_ENABLED, runOperation/resolveReview orchestrate through a Temporal
 * server: execute() starts runOperationWorkflow; resolve() starts resolveReviewWorkflow.
 * The @temporalio/client SDK is lazy-required (like the Anthropic SDK elsewhere) so the
 * default in-process path never loads it and the API typechecks/tests without the
 * native dependency installed. If the SDK is absent or the server is unreachable, the
 * engine logs and FALLS BACK to the in-process engine — behavior is preserved, never
 * failing open.
 *
 * The money/state side effects still run inside the activities → existing
 * ledgerService/identityService calls keyed on idempotency keys. Temporal orchestrates;
 * it never becomes a second ledger.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../../config";
import { logger } from "../../observability/logger";
import { setEngine, type WorkflowEngine } from "../engine";
import { inProcessEngine, type WorkflowDef, type AdminActor, type RunResult } from "../operationsWorkflow";

const RUN_WORKFLOW = "runOperationWorkflow";
const RESOLVE_WORKFLOW = "resolveReviewWorkflow";

/** Connect a Temporal client. Throws if the SDK is not installed or the server is down. */
async function connectClient(): Promise<{ client: unknown; close: () => Promise<void> }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const temporal = require("@temporalio/client");
  const connection = await temporal.Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const client = new temporal.Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  return { client, close: () => connection.close() };
}

async function startWorkflow(workflowType: string, workflowId: string, args: unknown[]): Promise<RunResult> {
  const { client, close } = await connectClient();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = await (client as any).workflow.start(workflowType, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      args,
    });
    return (await handle.result()) as RunResult;
  } finally {
    await close();
  }
}

export function createTemporalEngine(): WorkflowEngine {
  return {
    name: "temporal",
    async execute<Ctx, Rec>(def: WorkflowDef<Ctx, Rec>, input: unknown): Promise<RunResult> {
      try {
        return await startWorkflow(RUN_WORKFLOW, `op-${def.skill}-${uuidv4()}`, [def.skill, input]);
      } catch (e) {
        logger.warn({ err: (e as Error).message, skill: def.skill }, "Temporal execute failed; falling back to in-process");
        return inProcessEngine.execute(def, input);
      }
    },
    async resolve(reviewId: string, actor: AdminActor, humanDecision: "approve" | "reject", reason?: string): Promise<RunResult> {
      try {
        return await startWorkflow(RESOLVE_WORKFLOW, `resolve-${reviewId}-${uuidv4()}`, [reviewId, actor, humanDecision, reason]);
      } catch (e) {
        logger.warn({ err: (e as Error).message, reviewId }, "Temporal resolve failed; falling back to in-process");
        return inProcessEngine.resolve(reviewId, actor, humanDecision, reason);
      }
    },
  };
}

/** Boot wiring: select the Temporal engine when enabled. Default leaves in-process. */
export function selectOperationsEngine(): void {
  if (config.TEMPORAL_ENABLED) {
    setEngine(createTemporalEngine());
    logger.warn(
      { address: config.TEMPORAL_ADDRESS, taskQueue: config.TEMPORAL_TASK_QUEUE },
      "Operations engine: Temporal ENABLED (falls back to in-process if unavailable). Run `npm run temporal:worker`."
    );
  }
}
