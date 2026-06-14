/**
 * Phase 15.4 — Conductor task worker for the operations runner.
 *
 * Polls the Conductor OSS server for run_operation / resolve_review tasks and executes
 * them via the shared operation activities (which delegate to the in-process engine).
 * Runs as its own process: `npm run conductor:worker`. Importing the skills registers
 * their workflows so the activities can resolve them by name.
 *
 * Plain OSS REST: GET /tasks/poll/{type} to claim a task, POST /tasks to report result.
 */

import { config } from "../../config";
import { logger } from "../../observability/logger";
import { runOperationActivity, resolveReviewActivity } from "../activities";
import { conductorRequest, registerOperationsDefs } from "./client";
import { RUN_OPERATION_TASK, RESOLVE_REVIEW_TASK } from "./defs";
import "../skills"; // side effect: register all operations workflows

interface PolledTask {
  taskId?: string;
  workflowInstanceId?: string;
  inputData?: Record<string, unknown>;
}

const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
  [RUN_OPERATION_TASK]: (i) => runOperationActivity(i.skill as string, i.payload),
  [RESOLVE_REVIEW_TASK]: (i) =>
    resolveReviewActivity(i.reviewId as string, i.actor as never, i.decision as "approve" | "reject", i.reason as string),
};

export interface ConductorWorkerHandle {
  stopPolling: () => void;
}

export async function startOperationsConductorWorker(pollMs = 100): Promise<ConductorWorkerHandle> {
  await registerOperationsDefs();
  const workerId = `argus-ops-${process.pid}`;
  let running = true;

  async function pollOnce(taskType: string): Promise<void> {
    const task = await conductorRequest<PolledTask>(`/tasks/poll/${taskType}?workerid=${workerId}`);
    if (!task || !task.taskId) return;
    try {
      const outputData = await handlers[taskType]!(task.inputData ?? {});
      await conductorRequest("/tasks", {
        method: "POST",
        body: { workflowInstanceId: task.workflowInstanceId, taskId: task.taskId, status: "COMPLETED", outputData },
      });
    } catch (e) {
      await conductorRequest("/tasks", {
        method: "POST",
        body: {
          workflowInstanceId: task.workflowInstanceId,
          taskId: task.taskId,
          status: "FAILED",
          reasonForIncompletion: (e as Error).message,
          outputData: {},
        },
      });
    }
  }

  void (async () => {
    while (running) {
      try {
        await Promise.all([pollOnce(RUN_OPERATION_TASK), pollOnce(RESOLVE_REVIEW_TASK)]);
      } catch (e) {
        logger.warn({ err: (e as Error).message }, "Conductor poll error");
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  })();

  logger.info({ url: config.CONDUCTOR_URL }, "Operations Conductor worker polling (run_operation, resolve_review)");
  return { stopPolling: () => { running = false; } };
}

if (require.main === module) {
  startOperationsConductorWorker().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[conductor:worker] failed:", err);
    process.exit(1);
  });
}
