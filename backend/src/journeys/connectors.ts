/**
 * Connector framework (Pillar 3) — the runtime vendor marketplace + BYO seam.
 *
 * Unlike Argus's compile-time provider enums (IDV_PROVIDER, …), connectors are
 * REGISTERED AT RUNTIME with an id, so a journey's `connector` step names a vendor
 * by id and a journey-builder UI could add one without a deploy. Includes:
 *   - a simulated connector (offline default),
 *   - a generic BYO-HTTP connector (bring-your-own API / webhook),
 *   - waterfall/cascade: try connectors in order, first success wins (Alloy's signature).
 *
 * Production hardening (per-connector secret vault, request/response field mapping,
 * cost/rate limits, retries) is designed in docs/JOURNEY-ORCHESTRATION-PLATFORM.md;
 * the prototype proves the registry + BYO + waterfall contracts.
 */

import type { CelValue } from "./cel";

export interface ConnectorCall {
  ok: boolean;
  output: Record<string, CelValue>;
  error?: string;
}

export interface Connector {
  id: string;
  call(input: Record<string, CelValue>, ctx: { subjectUserId?: string }): Promise<ConnectorCall>;
}

const registry = new Map<string, Connector>();

export function registerConnector(c: Connector): void {
  registry.set(c.id, c);
}
export function getConnector(id: string): Connector | undefined {
  return registry.get(id);
}
export function listConnectors(): string[] {
  return [...registry.keys()];
}

/**
 * Waterfall: call connectors in order, returning the first success. Records every
 * attempt so the step trail shows the cascade (failover is auditable).
 */
export async function waterfall(
  ids: string[],
  input: Record<string, CelValue>,
  ctx: { subjectUserId?: string }
): Promise<{ result: ConnectorCall; usedId: string | null; attempts: Array<{ id: string; ok: boolean; error?: string }> }> {
  const attempts: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    const c = registry.get(id);
    if (!c) { attempts.push({ id, ok: false, error: "unregistered" }); continue; }
    let res: ConnectorCall;
    try {
      res = await c.call(input, ctx);
    } catch (e) {
      res = { ok: false, output: {}, error: e instanceof Error ? e.message : "error" };
    }
    attempts.push({ id, ok: res.ok, error: res.error });
    if (res.ok) return { result: res, usedId: id, attempts };
  }
  return { result: { ok: false, output: {}, error: "all connectors failed" }, usedId: null, attempts };
}

// ---- built-in connectors ----------------------------------------------------

/** Offline default — echoes a deterministic "verified" result for the prototype. */
function simulatedConnector(): Connector {
  return {
    id: "simulated",
    async call(input) {
      return { ok: true, output: { verified: true, matchScore: 92, echo: input } };
    },
  };
}

/** A connector that always fails — used to demonstrate waterfall failover in tests. */
function failingConnector(): Connector {
  return { id: "always-fail", async call() { return { ok: false, output: {}, error: "vendor unavailable" }; } };
}

/**
 * Generic Bring-Your-Own-HTTP connector. A journey references it with config
 * { url, method, headers, bodyTemplate } so any vendor/internal API plugs in
 * without a code change. Uses global fetch; off the money path.
 */
export function httpConnector(id: string, opts: { url: string; method?: string; headers?: Record<string, string> }): Connector {
  return {
    id,
    async call(input) {
      try {
        const res = await fetch(opts.url, {
          method: opts.method ?? "POST",
          headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, CelValue>;
        return { ok: res.ok, output: body, error: res.ok ? undefined : `http ${res.status}` };
      } catch (e) {
        return { ok: false, output: {}, error: e instanceof Error ? e.message : "fetch error" };
      }
    },
  };
}

/** Register the built-in connectors once (idempotent). */
export function registerDefaultConnectors(): void {
  if (!registry.has("simulated")) registerConnector(simulatedConnector());
  if (!registry.has("always-fail")) registerConnector(failingConnector());
}
