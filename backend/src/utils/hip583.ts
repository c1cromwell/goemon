/**
 * HIP-583 EVM alias for Hedera account ids (REQ-RX-001).
 * Uses the SDK when available; falls back to num-padded alias for tests/mocks.
 */

import { AccountId } from "@hashgraph/sdk";

/** Return the 0x-prefixed EVM address for a Hedera account id (e.g. 0.0.12345). */
export function hederaAccountToEvmAddress(hederaAccountId: string): string {
  const id = AccountId.fromString(hederaAccountId);
  let raw: string;
  if (typeof (id as AccountId & { toEvmAddress?: () => string }).toEvmAddress === "function") {
    raw = id.toEvmAddress();
  } else {
    const num = BigInt(hederaAccountId.split(".")[2] ?? "0");
    raw = num.toString(16).padStart(40, "0");
  }
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}
