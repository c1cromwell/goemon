/**
 * M4 — Model router types (task class → capability tier → vendor seam).
 */

export type CapabilityTier = "high" | "standard" | "fast";

export type ModelVendor = "anthropic" | "openai" | "google" | "local" | "cursor" | "chutes";

export type TaskClass =
  | "legal_draft"
  | "launch_decision"
  | "compliance_analysis"
  | "code_review"
  | "kyc_review"
  | "triage"
  | "summary"
  | "general"
  // Non-PII pilot task — internal marketing/content drafting. The one task class that may
  // route to Chutes (Bittensor SN64); never carries customer data. See vendorConfig.
  | "marketing_draft";

export interface RegistryEntry {
  id: string;
  vendor: ModelVendor;
  tier: CapabilityTier;
  model: string;
  contextWindow: number;
  /** Cost in micro-USD per 1k tokens (integer). */
  inputMicroUsdPer1k: number;
  outputMicroUsdPer1k: number;
  latencyClass: "slow" | "normal" | "fast";
  enabled: boolean;
}

export interface ModelInvokeRequest {
  taskClass: TaskClass;
  skill?: string;
  workflowRun?: string;
  system: string;
  userContent: string;
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
}

export interface ModelInvokeResult {
  modelId: string;
  vendor: ModelVendor;
  tier: CapabilityTier;
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costMicroUsd: number;
}

export interface ModelInvocationRow {
  id: string;
  taskClass: TaskClass;
  modelId: string;
  vendor: ModelVendor;
  skill: string | null;
  workflowRun: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  status: string;
  errorCode: string | null;
  createdAt: string;
}
