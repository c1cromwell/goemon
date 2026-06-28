/**
 * M4.1 — Vendor availability + task-class vendor pinning.
 */

import { config } from "../../config";
import type { ModelVendor, TaskClass } from "./types";

/** Compliance/regulated outputs stay on Anthropic when pinning is on (default). */
export const COMPLIANCE_PINNED_TASKS: TaskClass[] = [
  "kyc_review",
  "compliance_analysis",
  "legal_draft",
  "launch_decision",
];

/** Preferred vendor order per task (first configured vendor wins). */
export const TASK_VENDOR_PREFERENCE: Partial<Record<TaskClass, ModelVendor[]>> = {
  code_review: ["cursor", "anthropic", "openai"],
  general: ["anthropic", "openai", "cursor"],
  summary: ["anthropic", "openai", "cursor"],
  triage: ["anthropic", "openai", "cursor"],
};

export function cursorSdkInstalled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require.resolve("@cursor/sdk");
    return true;
  } catch {
    return false;
  }
}

export function isVendorConfigured(vendor: ModelVendor): boolean {
  switch (vendor) {
    case "anthropic":
      return !!(process.env.ANTHROPIC_API_KEY ?? config.ANTHROPIC_API_KEY);
    case "openai":
      return !!(process.env.OPENAI_API_KEY ?? config.OPENAI_API_KEY);
    case "cursor":
      return !!(process.env.CURSOR_API_KEY ?? config.CURSOR_API_KEY) && cursorSdkInstalled();
    case "google":
    case "local":
      return false;
    default:
      return false;
  }
}

/** null = any configured vendor allowed (cost-sorted). */
export function allowedVendorsForTask(taskClass: TaskClass): ModelVendor[] | null {
  if (config.MODEL_ROUTER_COMPLIANCE_ANTHROPIC_ONLY && COMPLIANCE_PINNED_TASKS.includes(taskClass)) {
    return ["anthropic"];
  }
  return TASK_VENDOR_PREFERENCE[taskClass] ?? null;
}
