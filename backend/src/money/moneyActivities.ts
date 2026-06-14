/**
 * Phase 20 — money-path Temporal activities.
 *
 * The activity IS the existing idempotency-keyed ledger transfer (transferService).
 * Because the ledger journal is keyed on the idempotency key, a Temporal retry of this
 * activity re-posts nothing — it returns the existing journal. That is the "exactly-once
 * at the ledger seam" the design calls for: Temporal provides durability/retry; the
 * ledger remains the single source of truth and never double-posts.
 *
 * Money is bigint minor units, which is not JSON-serializable across the Temporal
 * boundary, so amounts cross as decimal strings (TransferWire) and are converted back
 * to bigint here — money is never represented as a float.
 */

import { transfer, type TransferResult } from "../services/transferService";

export interface TransferWire {
  fromUserId: string;
  toUserId: string;
  amountMinor: string; // decimal string of the bigint minor units (no floats)
  currency: string;
  description?: string;
  idempotencyKey: string;
  channel?: string;
}

export async function transferActivity(wire: TransferWire): Promise<TransferResult> {
  return transfer({
    fromUserId: wire.fromUserId,
    toUserId: wire.toUserId,
    amountMinor: BigInt(wire.amountMinor),
    currency: wire.currency,
    description: wire.description,
    idempotencyKey: wire.idempotencyKey,
    channel: wire.channel,
  });
}
