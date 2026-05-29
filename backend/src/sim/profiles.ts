/**
 * Phase 5A — Simulated identity profiles.
 *
 * Each profile crafts raw onboarding signals (and any step artifacts) that flow
 * through the REAL signal scorer + orchestrator + sub-agents, so a generated demo
 * identity exercises a genuine risk path end-to-end rather than a hard-coded result.
 *
 * Isolation: simulated identities are flagged users.is_simulated=1 and use a "sim-"
 * email prefix, so they never collide with real users or the future *.demo.com seed
 * users. The email DOMAIN is chosen to drive the email-reputation sub-score; the
 * is_simulated flag (not the domain) is the isolation guarantee.
 */

import type { DocumentInput, PossessionInput } from "../services/onboardingAgents";
import type { Decision } from "../services/riskOrchestratorService";

export interface SimProfile {
  key: string;
  description: string;
  /** Drives the email-reputation score (corporate≈0.9, free≈0.7, disposable≈0.15). */
  emailDomain: string;
  /** Drives the IP-risk score (203.0.113.x=datacenter, 198.51.100.x=proxy, else residential). */
  ip: string;
  rapidCompletion: boolean;
  /** Document artifact to submit if the orchestrator requires document_validation. */
  document?: DocumentInput;
  /** Possession artifact to submit if the orchestrator requires possession_check. */
  possession?: PossessionInput;
  fullName: string;
  expectedDecision: Decision;
}

export const SIM_PROFILES: Record<string, SimProfile> = {
  low: {
    key: "low",
    description: "Clean signals — straight-through auto-approval, no sub-agents.",
    emailDomain: "acme-corp.example",
    ip: "192.168.10.5",
    rapidCompletion: false,
    fullName: "Ada Lowrisk",
    expectedDecision: "auto_approve",
  },
  medium: {
    key: "medium",
    description: "Bot-like timing → possession-check sub-agent spawned; passes → approved.",
    emailDomain: "gmail.com",
    ip: "192.168.10.6",
    rapidCompletion: true,
    possession: { code: "123456", factor: "email_otp" },
    fullName: "Ben Medium",
    expectedDecision: "auto_approve",
  },
  high: {
    key: "high",
    description: "Datacenter IP → document-validation spawned; tampered doc fails → manual review.",
    emailDomain: "gmail.com",
    ip: "203.0.113.7",
    rapidCompletion: false,
    document: { documentNumber: "2", documentType: "passport", fullName: "Cara Highrisk", country: "US" },
    fullName: "Cara Highrisk",
    expectedDecision: "manual_review",
  },
  review: {
    key: "review",
    description: "Disposable email → doc passes but the weak signal guardrail forces manual review.",
    emailDomain: "mailinator.com",
    ip: "192.168.10.8",
    rapidCompletion: false,
    document: { documentNumber: "7", documentType: "passport", fullName: "Dan Review", country: "US" },
    fullName: "Dan Review",
    expectedDecision: "manual_review",
  },
  reject: {
    key: "reject",
    description: "Sanctions hit during document validation → hard reject.",
    emailDomain: "mailinator.com",
    ip: "192.168.10.9",
    rapidCompletion: false,
    document: { documentNumber: "7", documentType: "passport", fullName: "OFAC Test", country: "US" },
    fullName: "OFAC Test",
    expectedDecision: "reject",
  },
};

export const DEFAULT_SIM_PROFILES = ["low", "medium", "high", "review", "reject"];
