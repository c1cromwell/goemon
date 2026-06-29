/**
 * Shared domain types for the fraud engine. The DTOs here form the wire contract
 * with any caller (Goemon keeps its own copy of RiskEvent/Decision — no shared
 * package, so the two services stay decoupled).
 */

export type FraudAction = "allow" | "flag" | "challenge" | "block" | "freeze";

/** A normalized money-path / journey event. Maps 1:1 to a Kafka record later. */
export interface RiskEvent {
  eventType: string; // transfer.send | login.attempt | account.view | ...
  mode: "score" | "async";
  userId: string;
  counterpartyId?: string;
  channel?: string; // api | smartchat | mcp | pay
  amountMinor?: bigint; // integer minor units
  currency?: string;
  deviceId?: string;
  ip?: string;
  geo?: string; // country/region code
  idempotencyKey?: string;
}

export interface Reason {
  code: string;
  weight: number;
}

/** A per-feature contribution to the score — the SHAP/LIME explanation analog. */
export interface Contribution {
  feature: string;
  contribution: number;
}

/** Output of a single model. Score is 0..1 and ADVISORY. */
export interface ModelOutput {
  score: number;
  reasons: Reason[];
  explanation: Contribution[];
  modelVersion: string;
}

export interface ShadowResult {
  modelVersion: string;
  score: number;
  action: FraudAction;
}

/** The decision returned to callers and persisted to the append-only audit topic. */
export interface Decision {
  decisionId: string;
  eventId: string;
  userId: string;
  mode: "score" | "async";
  score: number;
  action: FraudAction;
  reasons: Reason[];
  explanation: Contribution[];
  modelVersion: string;
  shadow?: ShadowResult[];
}
