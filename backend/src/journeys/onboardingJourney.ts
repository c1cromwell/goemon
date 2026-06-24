/**
 * The existing onboarding flow, re-expressed as DATA.
 *
 * riskOrchestratorService's hardcoded logic (assess signals → finalizeDecision →
 * auto_approve / step_up / manual_review / reject) becomes a declarative JourneyDef:
 * collect → connector (document waterfall) → risk_check → CEL branch → consent/
 * manual_review → complete. Changing a threshold is now editing a step's CEL, not a
 * code deploy. This is the proof of "rules-as-code → journey-as-data".
 *
 * Decision-only: it produces an outcome (approved/rejected) + the risk trail; it does
 * not grant a tier (the live tier-grant stays in identityService). Promotion path —
 * shadow this journey against riskOrchestratorService, then cut over — is in
 * docs/JOURNEY-ORCHESTRATION-PLATFORM.md.
 */

import type { JourneyDef } from "./types";
import { seedJourney } from "./journeyStore";

export const ONBOARDING_JOURNEY_ID = "onboarding";

export const ONBOARDING_JOURNEY: JourneyDef = {
  id: ONBOARDING_JOURNEY_ID,
  version: "v1",
  title: "Account opening",
  start: "collect_identity",
  steps: [
    {
      id: "collect_identity",
      type: "collect",
      config: {
        title: "Verify your identity",
        primaryAction: "Continue",
        fields: [
          { key: "fullName", label: "Full name", type: "text", required: true },
          { key: "dob", label: "Date of birth", type: "date", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          { key: "documentNumber", label: "ID document number", type: "text", required: true },
        ],
      },
      next: "verify_document",
    },
    {
      // Pillar 3 — vendor waterfall: try the primary IDV connector, fall back on failure.
      id: "verify_document",
      type: "connector",
      config: { connectors: ["always-fail", "simulated"] }, // demonstrates failover
      next: "kyc_risk",
    },
    {
      // Pillar 4 — risk/fraud as a node: signals lifted from the journey context.
      id: "kyc_risk",
      type: "risk_check",
      config: {
        signals: {
          sanctionsHit: "sanctionsHit",
          documentFailed: "!connectors.verify_document.ok",
          emailRisk: "emailRisk",
          deviceRisk: "deviceRisk",
          rapidCompletion: "rapidCompletion",
        },
      },
      branches: [
        { when: "risk.kyc_risk.decision == 'deny'", to: "rejected" },
        { when: "risk.kyc_risk.decision == 'review'", to: "manual_review" },
      ],
      next: "consent", // approve path
    },
    {
      id: "manual_review",
      type: "manual_review",
      branches: [{ when: "reviewDecision == 'approve'", to: "consent" }],
      next: "rejected",
    },
    {
      id: "consent",
      type: "consent",
      config: { title: "Terms & disclosures", label: "I agree to the Terms and Privacy Policy", version: "tos-v1" },
      next: "approved",
    },
    {
      id: "approved",
      type: "complete",
      config: { result: "'approved'", reasonCodes: [] },
    },
    {
      id: "rejected",
      type: "complete",
      config: { result: "'rejected'", reasonCodes: ["kyc_denied"] },
    },
  ],
};

/** Seed the built-in journeys (idempotent). Validates CEL at load. */
export async function seedDefaultJourneys(): Promise<void> {
  await seedJourney(ONBOARDING_JOURNEY);
}
