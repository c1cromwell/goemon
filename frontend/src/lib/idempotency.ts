/**
 * Idempotency keys for money-mutating POSTs.
 *
 * The backend requires an `Idempotency-Key` header on every money mutation
 * (transfers, subscriptions, orders, asset transfers, MFA confirmation, Hedera
 * transfers) and replays the original result on a repeated key — so the SAME
 * key must be reused across retries of the SAME logical action. Callers mint a
 * key once when the user initiates an action and pass it through retries.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // Fallback (older browsers): RFC4122-ish from getRandomValues.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
