/**
 * Goemon client — the engine's outbound callback into Goemon. This is the ONLY
 * coupling to Goemon, and it is over HTTP with a shared service bearer; the engine
 * imports no Goemon code. Injectable so tests assert calls without a network.
 *
 * Idempotency: every call carries the decisionId; Goemon dedupes on it, so a
 * retried freeze is a no-op.
 */

import { config } from "../config";
import { logger } from "../observability/logger";
import { remediationTotal } from "../observability/metrics";

export interface GoemonClient {
  freeze(args: { userId: string; reason: string; decisionId: string }): Promise<void>;
  unfreeze(args: { userId: string; reason: string; decisionId: string }): Promise<void>;
  flagTransaction(args: { userId: string; transactionRef: string; reason: string; decisionId: string }): Promise<void>;
}

class HttpGoemonClient implements GoemonClient {
  private async post(path: string, body: Record<string, unknown>, action: string): Promise<void> {
    try {
      const res = await fetch(`${config.GOEMON_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.GOEMON_SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        remediationTotal.inc({ action, result: "error" });
        logger.error({ path, status: res.status }, "goemon remediation call failed");
        return;
      }
      remediationTotal.inc({ action, result: "ok" });
    } catch (e) {
      remediationTotal.inc({ action, result: "error" });
      logger.error({ path, err: (e as Error).message }, "goemon remediation call threw");
    }
  }

  async freeze(args: { userId: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/freeze", args, "freeze");
  }
  async unfreeze(args: { userId: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/unfreeze", args, "unfreeze");
  }
  async flagTransaction(args: { userId: string; transactionRef: string; reason: string; decisionId: string }): Promise<void> {
    await this.post("/api/internal/remediation/flag-transaction", args, "flag");
  }
}

let _client: GoemonClient = new HttpGoemonClient();

export function getGoemonClient(): GoemonClient {
  return _client;
}

/** Inject a client (tests) or restore the default HTTP client (pass nothing). */
export function setGoemonClient(c: GoemonClient | null): void {
  _client = c ?? new HttpGoemonClient();
}
