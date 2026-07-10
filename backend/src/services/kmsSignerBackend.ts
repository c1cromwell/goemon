/**
 * Phase 1 — KMS-backed Hedera signer (the operator key never enters the process).
 *
 * Hedera ECDSA (secp256k1) signatures are over keccak256(message), returned as a 64-byte raw
 * r‖s (low-S). Cloud KMS secp256k1 keys sign a 32-byte digest and return a DER signature.
 * So the signer:
 *   1. computes keccak256(txBytes);
 *   2. hands that digest to KMS asymmetricSign (in KMS's `digest.sha256` field — ECDSA signs the
 *      32 bytes regardless of the label; the value is the keccak digest);
 *   3. converts the DER result to Hedera's 64-byte raw r‖s and normalizes to low-S.
 * The private key stays in KMS hardware — closing invariant m for the crown (operator) key.
 *
 * Verified locally: a signature produced this way is accepted by Hedera's own PublicKey.verify
 * (see kms-signer.test.ts). @noble/curves is pinned to v1 (the version @hashgraph bundles) for
 * signature-format interop.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { AppError, ErrorCode } from "../errors";
import type { HsmBackend } from "./signerService";

/** The digest Hedera ECDSA signs: keccak256 of the message bytes. */
export function hederaEcdsaDigest(message: Uint8Array): Uint8Array {
  return keccak_256(message);
}

/** DER ECDSA signature → Hedera's 64-byte raw r‖s, normalized to canonical low-S. */
export function derToRawSignature(der: Uint8Array): Uint8Array {
  return secp256k1.Signature.fromDER(der).normalizeS().toCompactRawBytes();
}

/**
 * Abstraction over a KMS that signs a 32-byte digest with an EC secp256k1 key and returns a
 * DER-encoded ECDSA signature. Injectable so tests can supply a local-key fake.
 */
export interface KmsDigestSigner {
  /** keyName = the full KMS crypto-key VERSION resource; digest = 32 bytes; returns DER sig. */
  signDigest(keyName: string, digest: Uint8Array): Promise<Uint8Array>;
}

/**
 * A Hedera transaction signer: raw message bytes → 64-byte raw Hedera ECDSA signature, signed by
 * the KMS-held key `keyName`. Suitable for Client.setOperatorWith and Transaction.signWith.
 */
export function hederaKmsSigner(kms: KmsDigestSigner, keyName: string): (message: Uint8Array) => Promise<Uint8Array> {
  return async (message: Uint8Array): Promise<Uint8Array> =>
    derToRawSignature(await kms.signDigest(keyName, hederaEcdsaDigest(message)));
}

/**
 * signerService HsmBackend adapter: the per-user `hsm` signer calls sign(keyRef, data); here
 * keyRef must be a KMS crypto-key VERSION resource name. (Per-user KMS signing additionally
 * needs an account→key mapping — the launch path is `keyvault`; this adapter serves the operator
 * and any future per-user KMS keys.)
 */
export function kmsHsmBackend(kms: KmsDigestSigner): HsmBackend {
  return { sign: (keyRef: string, data: Uint8Array) => hederaKmsSigner(kms, keyRef)(data) };
}

/** Real GCP Cloud KMS digest signer (lazy-requires @google-cloud/kms; ADC credentials). */
let cachedGcp: KmsDigestSigner | null = null;
export function gcpKmsDigestSigner(): KmsDigestSigner {
  if (cachedGcp) return cachedGcp;
  let clientPromise: Promise<KmsClient> | null = null;
  const getClient = (): Promise<KmsClient> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        let mod: { KeyManagementServiceClient: new () => KmsClient };
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          mod = require("@google-cloud/kms");
        } catch {
          throw new AppError(ErrorCode.INTERNAL, "@google-cloud/kms is not installed — `npm i @google-cloud/kms` for KMS operator signing");
        }
        return new mod.KeyManagementServiceClient();
      })();
    }
    return clientPromise;
  };
  cachedGcp = {
    async signDigest(keyName: string, digest: Uint8Array): Promise<Uint8Array> {
      const client = await getClient();
      // Pass the keccak digest in the sha256 field: KMS signs the 32 bytes as-is (the label is
      // immaterial to ECDSA). This is how a SHA256-typed secp256k1 KMS key signs Hedera's keccak.
      const [res] = await client.asymmetricSign({ name: keyName, digest: { sha256: Buffer.from(digest) } });
      if (!res.signature) {
        throw new AppError(ErrorCode.INTERNAL, "GCP KMS asymmetricSign returned no signature");
      }
      return typeof res.signature === "string" ? Buffer.from(res.signature, "base64") : Buffer.from(res.signature);
    },
  };
  return cachedGcp;
}

/** Minimal shape of the Cloud KMS client we use (avoids a hard type dep). */
interface KmsClient {
  asymmetricSign(req: {
    name: string;
    digest: { sha256: Buffer };
  }): Promise<[{ signature?: Uint8Array | string | null }]>;
}
