/**
 * Phase 1 — KMS-backed Hedera operator signing (the key never enters the process).
 *
 * The de-risking oracle: a signature produced by the KMS path (keccak256 digest → DER →
 * 64-byte raw low-S) is accepted by HEDERA'S OWN PublicKey.verify. A local secp256k1 key
 * stands in for the KMS-held key and returns a DER signature exactly as Cloud KMS would.
 * (The only thing not exercised here is the literal KMS network call — the mainnet
 * live-check is that acceptance gate.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { PublicKey } from "@hashgraph/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import type { KmsDigestSigner } from "../src/services/kmsSignerBackend";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

/** A local-key fake of Cloud KMS: signs the 32-byte digest, returns a DER signature. */
function fakeKms(sk: Uint8Array): KmsDigestSigner {
  return {
    async signDigest(_keyName: string, digest: Uint8Array): Promise<Uint8Array> {
      return secp256k1.sign(digest, sk).toDERRawBytes();
    },
  };
}

const KEY = "projects/p/locations/us/keyRings/goemon/cryptoKeys/hedera-operator/cryptoKeyVersions/1";

describe("Phase 1: KMS Hedera signer", () => {
  it("produces a signature Hedera's own verifier accepts (full chain)", async () => {
    const { hederaKmsSigner } = await import("../src/services/kmsSignerBackend");
    const sk = secp256k1.utils.randomPrivateKey();
    const pub = PublicKey.fromBytesECDSA(secp256k1.getPublicKey(sk, true));

    const signer = hederaKmsSigner(fakeKms(sk), KEY);
    const message = new TextEncoder().encode("frozen hedera transaction body bytes");
    const raw = await signer(message);

    expect(raw.length).toBe(64); // Hedera wants 64-byte raw r||s
    expect(pub.verify(message, raw)).toBe(true); // Hedera's SDK accepts it
  });

  it("signs keccak256 of the message (the Hedera ECDSA digest)", async () => {
    const { hederaEcdsaDigest } = await import("../src/services/kmsSignerBackend");
    const msg = new TextEncoder().encode("digest check");
    expect(Buffer.from(hederaEcdsaDigest(msg))).toEqual(Buffer.from(keccak_256(msg)));
  });

  it("normalizes a high-S DER signature to canonical low-S", async () => {
    const { derToRawSignature } = await import("../src/services/kmsSignerBackend");
    const sk = secp256k1.utils.randomPrivateKey();
    const digest = keccak_256(new TextEncoder().encode("low-s check"));
    const sig = secp256k1.sign(digest, sk); // @noble returns low-S
    const lowRaw = sig.toCompactRawBytes();

    // Build the high-S counterpart (s' = n - s) and DER-encode it — a KMS may return this.
    const highSig = new secp256k1.Signature(sig.r, secp256k1.CURVE.n - sig.s);
    expect(highSig.hasHighS()).toBe(true);
    const rawFromHigh = derToRawSignature(highSig.toDERRawBytes());

    // Normalized back to the canonical low-S encoding.
    expect(Buffer.from(rawFromHigh)).toEqual(Buffer.from(lowRaw));
    expect(secp256k1.Signature.fromCompact(rawFromHigh).hasHighS()).toBe(false);
  });

  it("serves the signerService HsmBackend adapter (keyRef = KMS key)", async () => {
    const { kmsHsmBackend } = await import("../src/services/kmsSignerBackend");
    const sk = secp256k1.utils.randomPrivateKey();
    const pub = PublicKey.fromBytesECDSA(secp256k1.getPublicKey(sk, true));
    const backend = kmsHsmBackend(fakeKms(sk));
    const message = new TextEncoder().encode("hsm-backend path");
    const raw = await backend.sign(KEY, message);
    expect(pub.verify(message, raw)).toBe(true);
  });
});
