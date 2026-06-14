/**
 * Phase 15.4 — Conductor OSS REST client (plain fetch; no SDK dependency).
 *
 * The @io-orkes SDK targets newer Orkes-only endpoints (e.g. updateTaskSync) that the
 * conductoross OSS server rejects, so we talk to the stable OSS REST API directly. Our
 * two flows need only: register defs, start a workflow, read its status, poll a task,
 * and update a task result.
 */

import { config } from "../../config";
import { taskDefs, operationWorkflowDef, resolveWorkflowDef } from "./defs";

function url(path: string): string {
  return `${config.CONDUCTOR_URL.replace(/\/$/, "")}${path}`;
}

interface ReqOpts {
  method?: string;
  body?: unknown;
  /** Accept these non-2xx statuses as success (e.g. 409 already-exists). */
  okStatuses?: number[];
}

/** One Conductor REST call. Returns parsed JSON, text, or undefined (204/empty). */
export async function conductorRequest<T = unknown>(path: string, opts: ReqOpts = {}): Promise<T | undefined> {
  const res = await fetch(url(path), {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && !(opts.okStatuses ?? []).includes(res.status)) {
    throw new Error(`Conductor ${opts.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T; // startWorkflow returns the workflowId as plain text
  }
}

/**
 * Register the operations task + workflow definitions. Idempotent: task defs ignore a
 * 409 (already registered); workflow defs use PUT (upsert), so re-running is safe.
 */
export async function registerOperationsDefs(): Promise<void> {
  await conductorRequest("/metadata/taskdefs", { method: "POST", body: taskDefs, okStatuses: [409] });
  await conductorRequest("/metadata/workflow", { method: "PUT", body: [operationWorkflowDef, resolveWorkflowDef] });
}
