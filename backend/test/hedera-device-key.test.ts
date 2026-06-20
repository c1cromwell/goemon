/**
 * Device public key parsing for non-custodial Hedera accounts.
 */

import { describe, it, expect } from "vitest";
import { PrivateKey } from "@hashgraph/sdk";
import { parseDevicePublicKey, publicKeyToStoredDer } from "../src/services/hederaPublicKey";

describe("hedera device public key", () => {
  it("parses raw Ed25519 hex (64 chars) from iOS CryptoKit/Hiero", () => {
    const pk = PrivateKey.generateED25519();
    const rawHex = pk.publicKey.toStringRaw();
    expect(rawHex).toHaveLength(64);
    const parsed = parseDevicePublicKey(rawHex);
    expect(parsed.toStringRaw()).toBe(rawHex);
    expect(publicKeyToStoredDer(parsed)).toBe(pk.publicKey.toStringDer());
  });

  it("still accepts Hedera DER / SDK string forms", () => {
    const pk = PrivateKey.generateED25519();
    const der = pk.publicKey.toStringDer();
    expect(parseDevicePublicKey(der).toStringDer()).toBe(der);
  });
});
