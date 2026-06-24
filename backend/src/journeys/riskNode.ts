/**
 * Risk/fraud as a journey node (Pillar 4).
 *
 * The `risk_check` step builds a risk signal from the ACCUMULATED journey context
 * and asks a RiskProvider for a decision + reason codes, which the journey then
 * branches on. This is the "fraud called at each step via a context" pattern — the
 * same engine that scores money events (fraudService → fraud-engine) is now a
 * drop-in step any journey can place anywhere.
 *
 * Default provider is simulated (offline, deterministic) so journeys run without
 * the fraud engine; the production swap calls fraudService/the fraud-engine over
 * HTTP behind this same interface (injected via setRiskProvider).
 */

import type { CelValue } from "./cel";

export interface RiskInput {
  subjectUserId?: string;
  /** Arbitrary signals lifted from the journey context (device, email, ip, amount, …). */
  signals: Record<string, CelValue>;
}

export interface RiskDecision {
  decision: "approve" | "review" | "deny";
  score: number; // 0..1
  reasonCodes: string[];
}

export interface RiskProvider {
  name: string;
  assess(input: RiskInput): Promise<RiskDecision>;
}

/**
 * Simulated risk: a tiny deterministic rule set over common onboarding signals so
 * the prototype demonstrates branching without external calls. Mirrors the kind of
 * signals signalService/the fraud engine produce.
 */
function simulatedProvider(): RiskProvider {
  return {
    name: "simulated",
    async assess({ signals }) {
      const reasonCodes: string[] = [];
      let score = 0;
      const num = (k: string) => (typeof signals[k] === "number" ? (signals[k] as number) : 0);
      const bool = (k: string) => signals[k] === true;

      if (bool("sanctionsHit")) { reasonCodes.push("sanctions_hit"); score += 1; }
      if (bool("documentFailed")) { reasonCodes.push("document_failed"); score += 0.6; }
      if (num("emailRisk") >= 70) { reasonCodes.push("risky_email"); score += 0.3; }
      if (num("deviceRisk") >= 70) { reasonCodes.push("risky_device"); score += 0.3; }
      if (bool("rapidCompletion")) { reasonCodes.push("rapid_completion"); score += 0.2; }

      const s = Math.min(1, score);
      const decision: RiskDecision["decision"] = reasonCodes.includes("sanctions_hit")
        ? "deny"
        : s >= 0.6
          ? "review"
          : "approve";
      return { decision, score: s, reasonCodes };
    },
  };
}

let provider: RiskProvider = simulatedProvider();
export function setRiskProvider(p: RiskProvider): void { provider = p; }
export function getRiskProvider(): RiskProvider { return provider; }

export async function assessRisk(input: RiskInput): Promise<RiskDecision> {
  return getRiskProvider().assess(input);
}
