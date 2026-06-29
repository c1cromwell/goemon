/**
 * Phase 20 — client to the standalone fraud engine (the `fraud-engine/` add-on).
 *
 * This is Goeman's ONLY coupling to the engine: HTTP + a shared service bearer, no
 * shared code. It is injectable (setFraudClient) exactly like reconciliation's
 * ChainBalanceProvider, so tests assert behavior without a network and CI never
 * calls out.
 *
 * Two paths, chosen by the in-Goeman triage (see fraudService):
 *   - scoreSync  — the blocking path: wait for an advisory decision. Degrades OPEN
 *                  (returns null ⇒ "no remote opinion") unless FRAUD_REMOTE_REQUIRED,
 *                  in which case an unreachable engine fails CLOSED (FRAUD_BLOCKED).
 *   - emitAsync  — fire-and-forget: ship the event, never block the transfer; the
 *                  engine may later call back to freeze the account.
 *
 * The remote score is ADVISORY. The deterministic local gate + account-freeze
 * state remain the only things that actually block money.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../observability/logger";
import { fraudRemoteCallTotal } from "../observability/metrics";

/** Mirrors the engine's RiskEvent wire shape (Goeman keeps its own copy). */
export interface RemoteRiskEvent {
  eventType: string;
  channel?: string;
  userId: string;
  counterpartyId?: string;
  amountMinor?: bigint;
  currency?: string;
  idempotencyKey?: string;
}

export interface RemoteDecision {
  decisionId: string;
  score: number;
  action: "allow" | "flag" | "challenge" | "block" | "freeze";
  reasons: { code: string; weight: number }[];
  modelVersion: string;
}

export interface FraudClient {
  /** Blocking advisory. null ⇒ no remote opinion (engine off/unreachable, degrade open). */
  scoreSync(ev: RemoteRiskEvent): Promise<RemoteDecision | null>;
  /** Fire-and-forget. Never throws, never blocks. */
  emitAsync(ev: RemoteRiskEvent): Promise<void>;
}

function wire(ev: RemoteRiskEvent): Record<string, unknown> {
  return {
    eventType: ev.eventType,
    channel: ev.channel,
    userId: ev.userId,
    counterpartyId: ev.counterpartyId,
    amountMinor: ev.amountMinor?.toString(),
    currency: ev.currency,
    idempotencyKey: ev.idempotencyKey,
  };
}

class HttpFraudClient implements FraudClient {
  private get enabled(): boolean {
    return config.FRAUD_REMOTE_ENABLED && !!config.FRAUD_ENGINE_URL;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${config.FRAUD_ENGINE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.FRAUD_ENGINE_API_KEY ?? ""}`,
      },
      body: JSON.stringify(body),
    });
  }

  async scoreSync(ev: RemoteRiskEvent): Promise<RemoteDecision | null> {
    if (!this.enabled) return null;
    try {
      const res = await this.post("/v1/events?mode=score", { ...wire(ev), mode: "score" });
      if (!res.ok) throw new Error(`fraud engine ${res.status}`);
      const d = (await res.json()) as RemoteDecision;
      fraudRemoteCallTotal.inc({ mode: "sync", result: "ok" });
      return d;
    } catch (e) {
      if (config.FRAUD_REMOTE_REQUIRED) {
        fraudRemoteCallTotal.inc({ mode: "sync", result: "error" });
        throw new AppError(
          ErrorCode.FRAUD_BLOCKED,
          "Fraud screening is temporarily unavailable; this transfer cannot be authorized right now."
        );
      }
      fraudRemoteCallTotal.inc({ mode: "sync", result: "degraded" });
      logger.warn({ err: (e as Error).message }, "fraud engine unreachable on sync path — degrading open");
      return null;
    }
  }

  async emitAsync(ev: RemoteRiskEvent): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await this.post("/v1/events?mode=async", { ...wire(ev), mode: "async" });
      fraudRemoteCallTotal.inc({ mode: "async", result: res.ok ? "ok" : "error" });
    } catch (e) {
      fraudRemoteCallTotal.inc({ mode: "async", result: "error" });
      logger.warn({ err: (e as Error).message }, "fraud engine unreachable on async path — dropping event");
    }
  }
}

let _client: FraudClient = new HttpFraudClient();

export function getFraudClient(): FraudClient {
  return _client;
}

/** Inject a client (tests) or restore the default HTTP client (pass nothing). */
export function setFraudClient(c: FraudClient | null): void {
  _client = c ?? new HttpFraudClient();
}
