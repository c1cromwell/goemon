/**
 * Phase 15.4 — Conductor workflow + task definitions for the operations runner.
 *
 * Conductor models workflows as JSON: SIMPLE tasks executed by external workers that
 * poll the server. We expose two thin workflows that delegate to one task each; the
 * task worker (conductor/worker.ts) runs our existing in-process operation logic, so
 * Conductor orchestrates while the single source of truth for gather→gate→execute
 * stays in operationsWorkflow. Money/state side effects remain in the deterministic
 * services keyed on idempotency keys — Conductor never becomes a second ledger.
 */

export const RUN_OPERATION_TASK = "run_operation";
export const RESOLVE_REVIEW_TASK = "resolve_review";
export const OPERATION_WORKFLOW = "operation_workflow";
export const RESOLVE_WORKFLOW = "resolve_workflow";
export const WORKFLOW_VERSION = 1;

export const taskDefs = [
  {
    name: RUN_OPERATION_TASK,
    description: "Run an internal agent operation (gather→invoke→gate→execute|queue)",
    retryCount: 0,
    timeoutSeconds: 120,
    responseTimeoutSeconds: 110,
    timeoutPolicy: "TIME_OUT_WF",
    ownerEmail: "ops@argusfinancial.com",
  },
  {
    name: RESOLVE_REVIEW_TASK,
    description: "Resolve a queued human review (approve/reject) for an agent operation",
    retryCount: 0,
    timeoutSeconds: 120,
    responseTimeoutSeconds: 110,
    timeoutPolicy: "TIME_OUT_WF",
    ownerEmail: "ops@argusfinancial.com",
  },
];

export const operationWorkflowDef = {
  name: OPERATION_WORKFLOW,
  description: "Internal agent operation",
  version: WORKFLOW_VERSION,
  ownerEmail: "ops@argusfinancial.com",
  schemaVersion: 2,
  inputParameters: ["skill", "payload"],
  tasks: [
    {
      name: RUN_OPERATION_TASK,
      taskReferenceName: "run_op",
      type: "SIMPLE",
      inputParameters: { skill: "${workflow.input.skill}", payload: "${workflow.input.payload}" },
    },
  ],
  outputParameters: { result: "${run_op.output}" },
};

export const resolveWorkflowDef = {
  name: RESOLVE_WORKFLOW,
  description: "Resolve a queued agent-operation review",
  version: WORKFLOW_VERSION,
  ownerEmail: "ops@argusfinancial.com",
  schemaVersion: 2,
  inputParameters: ["reviewId", "actor", "decision", "reason"],
  tasks: [
    {
      name: RESOLVE_REVIEW_TASK,
      taskReferenceName: "resolve",
      type: "SIMPLE",
      inputParameters: {
        reviewId: "${workflow.input.reviewId}",
        actor: "${workflow.input.actor}",
        decision: "${workflow.input.decision}",
        reason: "${workflow.input.reason}",
      },
    },
  ],
  outputParameters: { result: "${resolve.output}" },
};
