/**
 * Phase 5A — Risk orchestrator model.
 *
 * Turns a PII-FREE signal summary into a structured risk assessment:
 *   { pii_confidence, required_steps[], recommended_risk_tier, rationale }
 *
 * Two implementations behind config.ONBOARDING_ORCHESTRATOR (mirrors IDV_PROVIDER):
 *   - "simulated" — deterministic weighted fusion. Offline, used in tests and dev.
 *   - "anthropic" — the @anthropic-ai/sdk scorer using structured tool-use so the
 *     model returns a validated JSON shape (no free-text parsing).
 *
 * SECURITY: the assessment is ADVISORY ONLY. riskOrchestratorService applies
 * deterministic guardrails and is the only thing that grants a tier. The summary
 * passed here MUST contain only scores + categorical flags — never raw email/IP/
 * document data (extends the "never log raw PII" rule in CONVENTIONS.md). The
 * caller is responsible for building a minimized summary; this module never
 * receives or stores raw PII.
 */

import { config } from "../config";
import { logger } from "../observability/logger";

export type OnboardingStep = "document_validation" | "possession_check";
export type RiskTier = "low" | "medium" | "high";

/** PII-free input to the model. Scores are in [0,1]; 1 = lowest risk / highest trust. */
export interface SignalSummary {
  email_score: number;
  ip_score: number;
  device_score: number;
  behavior_score: number;
  /** Coarse, non-identifying categories — safe to send to the model. */
  email_category: "disposable" | "free" | "corporate" | "unknown";
  ip_category: "datacenter" | "residential" | "vpn_or_proxy" | "unknown";
  device_reuse: boolean;
  rapid_completion: boolean;
}

export interface RiskAssessment {
  /** Fused PII-verification confidence in [0,1]. */
  pii_confidence: number;
  /** Verification steps the orchestrator should run before granting the tier. */
  required_steps: OnboardingStep[];
  recommended_risk_tier: RiskTier;
  rationale: string;
}

const WEIGHTS = { email: 0.25, ip: 0.2, device: 0.25, behavior: 0.3 } as const;
const STEP_TRIGGER = 0.6; // a sub-score below this nominates its step

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function tierFor(confidence: number): RiskTier {
  if (confidence >= 0.8) return "low";
  if (confidence >= 0.6) return "medium";
  return "high";
}

/** Deterministic weighted fusion — the default orchestrator and the test oracle. */
export function assessRiskSimulated(s: SignalSummary): RiskAssessment {
  const confidence = clamp01(
    s.email_score * WEIGHTS.email +
      s.ip_score * WEIGHTS.ip +
      s.device_score * WEIGHTS.device +
      s.behavior_score * WEIGHTS.behavior
  );

  const steps = new Set<OnboardingStep>();
  // Weak identity signals (who they claim to be) → prove identity with a document.
  if (s.email_score < STEP_TRIGGER || s.ip_score < STEP_TRIGGER) steps.add("document_validation");
  // Weak device/behavior signals (do they control this session) → prove possession.
  if (s.device_score < STEP_TRIGGER || s.behavior_score < STEP_TRIGGER || s.device_reuse) {
    steps.add("possession_check");
  }

  return {
    pii_confidence: confidence,
    required_steps: [...steps],
    recommended_risk_tier: tierFor(confidence),
    rationale:
      `Weighted signal fusion: email=${s.email_score.toFixed(2)} ip=${s.ip_score.toFixed(2)} ` +
      `device=${s.device_score.toFixed(2)} behavior=${s.behavior_score.toFixed(2)} → ` +
      `confidence=${confidence.toFixed(2)}.`,
  };
}

const SUBMIT_TOOL = {
  name: "submit_risk_assessment",
  description:
    "Submit the structured KYC risk assessment for this onboarding session.",
  input_schema: {
    type: "object" as const,
    properties: {
      pii_confidence: {
        type: "number",
        description: "Confidence the applicant's claimed identity is genuine, 0..1.",
      },
      required_steps: {
        type: "array",
        items: { type: "string", enum: ["document_validation", "possession_check"] },
        description: "Verification steps required before granting access.",
      },
      recommended_risk_tier: { type: "string", enum: ["low", "medium", "high"] },
      rationale: { type: "string", description: "One-sentence justification." },
    },
    required: ["pii_confidence", "required_steps", "recommended_risk_tier", "rationale"],
  },
};

const SYSTEM_PROMPT =
  "You are a KYC risk analyst for a neobank. You are given ONLY minimized, non-identifying " +
  "signal scores (0..1, where 1 is lowest risk) and coarse categorical flags for an account-opening " +
  "attempt. Assess how confident we can be that the applicant's claimed identity is genuine, and decide " +
  "which additional verification steps are required. Lower confidence and weaker signals should require " +
  "more steps. Always call the submit_risk_assessment tool with your structured answer.";

/** Normalize/clamp a model-produced assessment so downstream code can trust its shape. */
function sanitizeAssessment(raw: Partial<RiskAssessment>): RiskAssessment {
  const validSteps: OnboardingStep[] = ["document_validation", "possession_check"];
  const steps = Array.isArray(raw.required_steps)
    ? raw.required_steps.filter((x): x is OnboardingStep => validSteps.includes(x as OnboardingStep))
    : [];
  const confidence = clamp01(Number(raw.pii_confidence));
  const tier: RiskTier =
    raw.recommended_risk_tier === "low" || raw.recommended_risk_tier === "medium" || raw.recommended_risk_tier === "high"
      ? raw.recommended_risk_tier
      : tierFor(confidence);
  return {
    pii_confidence: confidence,
    required_steps: [...new Set(steps)],
    recommended_risk_tier: tier,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 500) : "Model assessment.",
  };
}

async function assessRiskAnthropic(s: SignalSummary): Promise<RiskAssessment> {
  // Lazy-require so the SDK is never loaded in the simulated/test path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
    messages: [{ role: "user", content: JSON.stringify(s) }],
  });

  const toolUse = (message.content as Array<{ type: string; name?: string; input?: unknown }>).find(
    (block) => block.type === "tool_use" && block.name === SUBMIT_TOOL.name
  );
  if (!toolUse || typeof toolUse.input !== "object") {
    throw new Error("Anthropic orchestrator returned no tool_use block");
  }
  return sanitizeAssessment(toolUse.input as Partial<RiskAssessment>);
}

/**
 * Produce a risk assessment for a PII-free signal summary. Uses the configured
 * orchestrator; if the Anthropic call fails for any reason we fall back to the
 * deterministic assessor so onboarding never hard-fails on a model outage. The
 * returned `orchestrator` reports which path actually produced the result.
 */
export async function assessRisk(
  summary: SignalSummary
): Promise<{ assessment: RiskAssessment; orchestrator: "simulated" | "anthropic" }> {
  if (config.ONBOARDING_ORCHESTRATOR === "anthropic" && config.ANTHROPIC_API_KEY) {
    try {
      const assessment = await assessRiskAnthropic(summary);
      return { assessment, orchestrator: "anthropic" };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Anthropic orchestrator failed; using simulated fallback");
    }
  }
  return { assessment: assessRiskSimulated(summary), orchestrator: "simulated" };
}
