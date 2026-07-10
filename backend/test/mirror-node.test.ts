/**
 * Phase 1 step 3 — Hedera Mirror Node balance provider (reconciliation reads real on-chain
 * USDC via the public node). Verifies parsing + the bounded backoff (transient 429/5xx retry,
 * 4xx fail-fast) with an injected fetch/sleep — no network, no real delays.
 */
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}
/** A fetch fake that returns each queued response in order. */
function sequenceFetch(responses: Response[]): { fn: typeof fetch; calls: () => number } {
  let i = 0;
  const fn = (async () => responses[Math.min(i++, responses.length - 1)]!) as unknown as typeof fetch;
  return { fn, calls: () => i };
}
const noSleep = async () => {};
const OPTS = { baseUrl: "https://mock.mirror", sleep: noSleep, attempts: 3, timeoutMs: 100 };

describe("Phase 1: Mirror Node balance provider", () => {
  it("parses the on-chain USDC micro balance from a token response", async () => {
    const { mirrorNodeProvider } = await import("../src/services/reconciliationService");
    const { fn } = sequenceFetch([res(200, { tokens: [{ balance: "125000000" }] })]);
    const p = mirrorNodeProvider({ ...OPTS, fetchImpl: fn });
    expect(await p.getUsdcBalanceMicro("0.0.1234")).toBe(125_000_000n);
  });

  it("returns 0 when the account holds no USDC (empty tokens)", async () => {
    const { mirrorNodeProvider } = await import("../src/services/reconciliationService");
    const { fn } = sequenceFetch([res(200, { tokens: [] })]);
    const p = mirrorNodeProvider({ ...OPTS, fetchImpl: fn });
    expect(await p.getUsdcBalanceMicro("0.0.1")).toBe(0n);
  });

  it("retries a transient 429 then succeeds", async () => {
    const { mirrorNodeProvider } = await import("../src/services/reconciliationService");
    const { fn, calls } = sequenceFetch([res(429), res(200, { tokens: [{ balance: 7 }] })]);
    const p = mirrorNodeProvider({ ...OPTS, fetchImpl: fn });
    expect(await p.getUsdcBalanceMicro("0.0.9")).toBe(7n);
    expect(calls()).toBe(2); // retried once
  });

  it("gives up after exhausting attempts on persistent 5xx", async () => {
    const { mirrorNodeProvider } = await import("../src/services/reconciliationService");
    const { fn, calls } = sequenceFetch([res(500), res(500), res(500)]);
    const p = mirrorNodeProvider({ ...OPTS, fetchImpl: fn });
    await expect(p.getUsdcBalanceMicro("0.0.9")).rejects.toThrow(/Mirror node 500/);
    expect(calls()).toBe(3);
  });

  it("fails fast on a 4xx (no retry)", async () => {
    const { mirrorNodeProvider } = await import("../src/services/reconciliationService");
    const { fn, calls } = sequenceFetch([res(404), res(200, { tokens: [{ balance: 1 }] })]);
    const p = mirrorNodeProvider({ ...OPTS, fetchImpl: fn });
    await expect(p.getUsdcBalanceMicro("0.0.9")).rejects.toThrow(/Mirror node 404/);
    expect(calls()).toBe(1); // did NOT retry
  });
});
