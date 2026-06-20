/**
 * Parse a device-supplied Hedera public key for non-custodial account provisioning.
 *
 * Accepts:
 *   - raw Ed25519 public key hex (64 chars — CryptoKit / Hiero toStringRaw)
 *   - Hedera DER / SDK string forms (PublicKey.fromString)
 *   - legacy private-key DER (tests / dev — extracts the public key)
 */

import { PrivateKey, PublicKey } from "@hashgraph/sdk";

export function parseDevicePublicKey(input: string): PublicKey {
  const trimmed = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return PublicKey.fromStringED25519(trimmed);
  }
  try {
    return PublicKey.fromString(trimmed);
  } catch {
    return PrivateKey.fromStringDer(trimmed).publicKey;
  }
}

/** Canonical storage form for hedera_accounts.public_key (DER string). */
export function publicKeyToStoredDer(publicKey: PublicKey): string {
  return publicKey.toStringDer();
}
