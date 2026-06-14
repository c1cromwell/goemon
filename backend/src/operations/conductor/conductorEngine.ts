/**
 * Phase 15.4 — Conductor-backed WorkflowEngine (the PRIMARY agent substrate when
 * CONDUCTOR_ENABLED; design §7: Conductor for agents, Temporal for money).
 *
 * execute() starts operation_workflow; resolve() starts resolve_workflow; both poll to
 * completion (plain OSS REST) and read the task worker's output. If the server is
 * unavailable the engine FALLS BACK to the in-process engine — never failing open.
 * Money/state side effects run inside the task worker via the existing services.
 */

import { logger } from "../../observability/logger";
import { type WorkflowEngine } from "../engine";
import { inProcessEngine, type WorkflowDef, type AdminActor, type RunResult } from "../operationsWorkflow";
import { conductorRequest } from "./client";
import { OPERATION_WORKFLOW, RESOLVE_WORKFLOW, WORKFLOW_VERSION } from "./defs";

const TERMINAL = new Set(["COMPLETED", "FAILED", "TERMINATED", "TIMED_OUT"]);
const POLL_MS = 200;
const TIMEOUT_MS = 30_000;

interface WorkflowStatus {
  status: string;
  output?: { result?: RunResult };
}

async function runWorkflowToCompletion(name: string, input: Record<string, unknown>): Promise<RunResult> {
  const workflowId = await conductorRequest<string>(`/workflow/${name}?version=${WORKFLOW_VERSION}`, {
    method: "POST",
    body: input,
  });
  if (!workflowId) throw new Error(`Conductor did not return a workflowId for ${name}`);

  const deadline = Date.now() + TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const wf = await conductorRequest<WorkflowStatus>(`/workflow/${workflowId}?includeTasks=false`);
    if (wf && TERMINAL.has(wf.status)) {
      if (wf.status !== "COMPLETED") throw new Error(`Conductor workflow ${name} ended ${wf.status}`);
      if (!wf.output?.result) throw new Error(`Conductor workflow ${name} produced no result`);
      return wf.output.result;
    }
    if (Date.now() > deadline) throw new Error(`Conductor workflow ${name} timed out`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export function createConductorEngine(): WorkflowEngine {
  return {
    name: "conductor",
    async execute<Ctx, Rec>(def: WorkflowDef<Ctx, Rec>, input: unknown): Promise<RunResult> {
      try {
        return await runWorkflowToCompletion(OPERATION_WORKFLOW, { skill: def.skill, payload: input });
      } catch (e) {
        logger.warn({ err: (e as Error).message, skill: def.skill }, "Conductor execute failed; falling back to in-process");
        return inProcessEngine.execute(def, input);
      }
    },
    async resolve(reviewId: string, actor: AdminActor, humanDecision: "approve" | "reject", reason?: string): Promise<RunResult> {
      try {
        return await runWorkflowToCompletion(RESOLVE_WORKFLOW, { reviewId, actor, decision: humanDecision, reason });
      } catch (e) {
        logger.warn({ err: (e as Error).message, reviewId }, "Conductor resolve failed; falling back to in-process");
        return inProcessEngine.resolve(reviewId, actor, humanDecision, reason);
      }
    },
  };
}
