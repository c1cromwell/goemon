/**
 * M4 — Model router: task class → cheapest qualifying model + fallback chain.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db";
import { config } from "../../config";
import { AppError, ErrorCode } from "../../errors";
import { MODEL_REGISTRY, TASK_TIER, registryForTier, routingPreview, isVendorConfigured, COMPLIANCE_PINNED_TASKS, allowedVendorsForTask, TASK_VENDOR_PREFERENCE } from "./registry";
import { invokeProvider } from "./providers";
import type {
  ModelInvokeRequest,
  ModelInvokeResult,
  ModelInvocationRow,
  RegistryEntry,
  TaskClass,
} from "./types";

export { MODEL_REGISTRY, TASK_TIER, routingPreview, isVendorConfigured, COMPLIANCE_PINNED_TASKS, allowedVendorsForTask, TASK_VENDOR_PREFERENCE };
export type { TaskClass, ModelInvokeRequest, ModelInvokeResult, RegistryEntry, ModelInvocationRow };

export function assertModelRouterEnabled(): void {
  if (!config.MODEL_ROUTER_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Model router is disabled");
  }
}

/** Select primary + fallback models for a task class (vendor preference + cheapest in tier). */
export function selectModels(taskClass: TaskClass): RegistryEntry[] {
  const tier = TASK_TIER[taskClass] ?? "fast";
  const chain: RegistryEntry[] = [];
  const tiers =
    tier === "high"
      ? (["high", "standard", "fast"] as const)
      : tier === "standard"
        ? (["standard", "fast"] as const)
        : (["fast"] as const);
  for (const t of tiers) {
    for (const e of registryForTier(t, taskClass)) {
      if (!chain.some((x) => x.id === e.id)) chain.push(e);
    }
  }
  if (chain.length === 0) {
    throw new AppError(ErrorCode.INTERNAL, `No enabled models for task class ${taskClass}`);
  }
  return chain;
}

async function logInvocation(row: {
  taskClass: TaskClass;
  modelId: string;
  vendor: string;
  skill?: string;
  workflowRun?: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  status: string;
  errorCode?: string;
}): Promise<void> {
  if (!config.MODEL_ROUTER_ENABLED) return;
  await getDb().execute(
    `INSERT INTO model_invocations
       (id, task_class, model_id, vendor, skill, workflow_run, input_tokens, output_tokens,
        cost_micro_usd, latency_ms, status, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      row.taskClass,
      row.modelId,
      row.vendor,
      row.skill ?? null,
      row.workflowRun ?? null,
      row.inputTokens,
      row.outputTokens,
      row.costMicroUsd,
      row.latencyMs,
      row.status,
      row.errorCode ?? null,
      new Date().toISOString(),
    ]
  );
}

/** Route and invoke with fallback chain; logs every attempt to model_invocations. */
export async function invokeModel(req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  assertModelRouterEnabled();
  const chain = selectModels(req.taskClass);
  let lastErr: unknown;
  for (const entry of chain) {
    try {
      const result = await invokeProvider(entry, req);
      await logInvocation({
        taskClass: req.taskClass,
        modelId: result.modelId,
        vendor: result.vendor,
        skill: req.skill,
        workflowRun: req.workflowRun,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicroUsd: result.costMicroUsd,
        latencyMs: result.latencyMs,
        status: "ok",
      });
      return result;
    } catch (e) {
      lastErr = e;
      const code = e instanceof AppError ? e.code : "INTERNAL";
      await logInvocation({
        taskClass: req.taskClass,
        modelId: entry.id,
        vendor: entry.vendor,
        skill: req.skill,
        workflowRun: req.workflowRun,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        latencyMs: 0,
        status: "error",
        errorCode: code,
      });
    }
  }
  throw lastErr instanceof Error ? lastErr : new AppError(ErrorCode.INTERNAL, "Model invocation failed");
}

export async function listInvocations(limit = 50): Promise<ModelInvocationRow[]> {
  assertModelRouterEnabled();
  const rows = await getDb().query<{
    id: string;
    task_class: TaskClass;
    model_id: string;
    vendor: ModelInvocationRow["vendor"];
    skill: string | null;
    workflow_run: string | null;
    input_tokens: number;
    output_tokens: number;
    cost_micro_usd: number;
    latency_ms: number;
    status: string;
    error_code: string | null;
    created_at: string;
  }>("SELECT * FROM model_invocations ORDER BY created_at DESC LIMIT ?", [limit]);
  return rows.map((r) => ({
    id: r.id,
    taskClass: r.task_class,
    modelId: r.model_id,
    vendor: r.vendor,
    skill: r.skill,
    workflowRun: r.workflow_run,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costMicroUsd: r.cost_micro_usd,
    latencyMs: r.latency_ms,
    status: r.status,
    errorCode: r.error_code,
    createdAt: r.created_at,
  }));
}

export async function invocationStats(): Promise<{
  totalInvocations: number;
  totalCostMicroUsd: number;
  byTaskClass: Record<string, { count: number; costMicroUsd: number }>;
}> {
  assertModelRouterEnabled();
  const db = getDb();
  const total = await db.queryOne<{ n: number; cost: number }>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(cost_micro_usd), 0) AS cost FROM model_invocations WHERE status = 'ok'"
  );
  const byTask = await db.query<{ task_class: string; n: number; cost: number }>(
    `SELECT task_class, COUNT(*) AS n, COALESCE(SUM(cost_micro_usd), 0) AS cost
     FROM model_invocations WHERE status = 'ok' GROUP BY task_class`
  );
  const byTaskClass: Record<string, { count: number; costMicroUsd: number }> = {};
  for (const row of byTask) {
    byTaskClass[row.task_class] = { count: row.n, costMicroUsd: row.cost };
  }
  return {
    totalInvocations: total?.n ?? 0,
    totalCostMicroUsd: total?.cost ?? 0,
    byTaskClass,
  };
}
