/**
 * M4 — Claude-tiered model registry (+ OpenAI + Cursor Composer vendors).
 */

import { config } from "../../config";
import type { CapabilityTier, RegistryEntry, TaskClass } from "./types";
import { allowedVendorsForTask, isVendorConfigured } from "./vendorConfig";

export const TASK_TIER: Record<TaskClass, CapabilityTier> = {
  legal_draft: "high",
  launch_decision: "high",
  compliance_analysis: "standard",
  code_review: "standard",
  kyc_review: "standard",
  triage: "fast",
  summary: "fast",
  general: "fast",
  marketing_draft: "standard",
};

/** Default registry — vendors enabled when API keys (+ @cursor/sdk for cursor) are present. */
export const MODEL_REGISTRY: RegistryEntry[] = [
  {
    id: "claude-opus-4",
    vendor: "anthropic",
    tier: "high",
    model: "claude-opus-4-20250514",
    contextWindow: 200_000,
    inputMicroUsdPer1k: 15_000,
    outputMicroUsdPer1k: 75_000,
    latencyClass: "slow",
    enabled: true,
  },
  {
    id: "claude-sonnet-4",
    vendor: "anthropic",
    tier: "standard",
    model: "claude-sonnet-4-20250514",
    contextWindow: 200_000,
    inputMicroUsdPer1k: 3_000,
    outputMicroUsdPer1k: 15_000,
    latencyClass: "normal",
    enabled: true,
  },
  {
    id: "claude-haiku-4",
    vendor: "anthropic",
    tier: "fast",
    model: config.ANTHROPIC_MODEL,
    contextWindow: 200_000,
    inputMicroUsdPer1k: 250,
    outputMicroUsdPer1k: 1_250,
    latencyClass: "fast",
    enabled: true,
  },
  {
    id: "gpt-4o",
    vendor: "openai",
    tier: "standard",
    model: config.OPENAI_MODEL,
    contextWindow: 128_000,
    inputMicroUsdPer1k: 2_500,
    outputMicroUsdPer1k: 10_000,
    latencyClass: "normal",
    enabled: true,
  },
  {
    id: "gpt-4o-mini",
    vendor: "openai",
    tier: "fast",
    model: config.OPENAI_FAST_MODEL,
    contextWindow: 128_000,
    inputMicroUsdPer1k: 150,
    outputMicroUsdPer1k: 600,
    latencyClass: "fast",
    enabled: true,
  },
  {
    id: "composer-2.5",
    vendor: "cursor",
    tier: "standard",
    model: config.CURSOR_MODEL,
    contextWindow: 200_000,
    inputMicroUsdPer1k: 500,
    outputMicroUsdPer1k: 2_500,
    latencyClass: "normal",
    enabled: true,
  },
  {
    id: "composer-2.5-fast",
    vendor: "cursor",
    tier: "fast",
    model: config.CURSOR_MODEL,
    contextWindow: 200_000,
    inputMicroUsdPer1k: 500,
    outputMicroUsdPer1k: 2_500,
    latencyClass: "fast",
    enabled: true,
  },
  {
    // Chutes / Bittensor SN64 — opt-in, enabled only when CHUTES_API_KEY is set
    // (isVendorConfigured gate). Reachable solely from the marketing_draft task class.
    id: "chutes-deepseek-v3",
    vendor: "chutes",
    tier: "standard",
    model: config.CHUTES_MODEL,
    contextWindow: 128_000,
    inputMicroUsdPer1k: 300,
    outputMicroUsdPer1k: 1_200,
    latencyClass: "normal",
    enabled: true,
  },
  {
    id: "gemini-pro-stub",
    vendor: "google",
    tier: "standard",
    model: "gemini-1.5-pro",
    contextWindow: 128_000,
    inputMicroUsdPer1k: 1_250,
    outputMicroUsdPer1k: 5_000,
    latencyClass: "normal",
    enabled: false,
  },
  {
    id: "local-llm-stub",
    vendor: "local",
    tier: "fast",
    model: "local/default",
    contextWindow: 32_000,
    inputMicroUsdPer1k: 0,
    outputMicroUsdPer1k: 0,
    latencyClass: "fast",
    enabled: false,
  },
];

export function registryForTier(tier: CapabilityTier, taskClass?: TaskClass): RegistryEntry[] {
  const pref = taskClass ? allowedVendorsForTask(taskClass) : null;
  let entries = MODEL_REGISTRY.filter((e) => e.tier === tier && e.enabled && isVendorConfigured(e.vendor));
  if (pref) {
    entries = entries.filter((e) => pref.includes(e.vendor));
    entries.sort(
      (a, b) =>
        pref.indexOf(a.vendor) - pref.indexOf(b.vendor) || a.inputMicroUsdPer1k - b.inputMicroUsdPer1k
    );
  } else {
    entries.sort((a, b) => a.inputMicroUsdPer1k - b.inputMicroUsdPer1k);
  }
  return entries;
}

export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return MODEL_REGISTRY.find((e) => e.id === id);
}

export function routingPreview(): Array<{ taskClass: TaskClass; tier: CapabilityTier; primaryModel: string; vendor: string }> {
  return (Object.keys(TASK_TIER) as TaskClass[]).map((taskClass) => {
    const tier = TASK_TIER[taskClass];
    const primary = registryForTier(tier, taskClass)[0];
    return {
      taskClass,
      tier,
      primaryModel: primary?.id ?? "none",
      vendor: primary?.vendor ?? "none",
    };
  });
}

export { allowedVendorsForTask, isVendorConfigured, COMPLIANCE_PINNED_TASKS, TASK_VENDOR_PREFERENCE } from "./vendorConfig";
