/**
 * Phase 20 — Key-vault custody seam (closes Phase-14 invariant *m* / audit C-1).
 *
 * Secrets the server must hold at rest — per-user Hedera Ed25519 private keys
 * (hedera_accounts) and the platform issuer JWK (did_keys) — are no longer stored
 * as plaintext. They are wrapped through a pluggable KeyVaultProvider:
 *
 *   - localAeadProvider()  — AES-256-GCM with a server-held master key. Dev/test
 *                            default. Encryption-at-rest with a server-held key is
 *                            strictly better than plaintext, but it is NOT on-device
 *                            / HSM custody — so it is REFUSED in production
 *                            (see config.productionFatals).
 *   - gcpKmsProvider()     — REAL: wraps/unwraps via Google Cloud KMS symmetric
 *                            encrypt/decrypt (the crypto key never leaves KMS;
 *                            the DB holds only KMS ciphertext). Lazy-requires
 *                            @google-cloud/kms so the app typechecks/tests without
 *                            the dep. Selected by KMS_PROVIDER=gcp + KMS_KEY_NAME.
 *   - awsKmsProvider()     — interface stub for the AWS swap (throws NOT_IMPLEMENTED
 *                            until wired); the point is the seam (call sites never change).
 *
 * Mirrors the injectable-provider pattern in reconciliationService
 * (setChainBalanceProvider). Tests inject a fake via setKeyVaultProvider().
 *
 * Wrapped format (versioned, self-describing so legacy plaintext is unambiguous):
 *   local:  gcm.v1.<ivB64url>.<tagB64url>.<ciphertextB64url>
 *   gcp:    gcm.v1.gcp.<kmsCiphertextB64url>
 * Both share the WRAP_PREFIX so isWrapped()/config's operator-key check treat any
 * provider's output as "wrapped"; the second segment discriminates the scheme.
 *
 * AAD (additional authenticated data) binds each ciphertext to its row identity
 * (a userId for Hedera keys, a kid for DID keys) so a ciphertext cannot be lifted
 * from one row and replayed into another.
 */

import * as crypto from "crypto";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export const WRAP_PREFIX = "gcm.v1.";

/** Dev/test master-key sentinel — mirrors the dev defaults in config.ts. */
export const KNOWN_DEV_KMS_KEY = "kms_dev_master_change_in_production";

export interface KeyVaultProvider {
  /** Wrap a plaintext secret. `context.aad` binds it to its row identity. */
  wrap(plaintext: string, context: { aad: string }): Promise<string>;
  /** Unwrap a value produced by wrap(). Throws on tamper / wrong key / AAD mismatch. */
  unwrap(wrapped: string, context: { aad: string }): Promise<string>;
}

let provider: KeyVaultProvider | null = null;

/** Inject a provider (tests) or clear it (null → re-derive default on next get). */
export function setKeyVaultProvider(p: KeyVaultProvider | null): void {
  provider = p;
}

/** The active provider. Lazily wires the default if none is set. */
export function getKeyVault(): KeyVaultProvider {
  if (!provider) provider = defaultProvider();
  return provider;
}

/** Wire the default provider. Call once at boot, before initDid()/initHedera(). */
export function initKeyVault(): void {
  provider = defaultProvider();
}

/** True for a value previously produced by a provider's wrap(). */
export function isWrapped(value: string): boolean {
  return value.startsWith(WRAP_PREFIX);
}

// ---------------------------------------------------------------------------

function defaultProvider(): KeyVaultProvider {
  switch (config.KMS_PROVIDER) {
    case "aws":
      return awsKmsProvider();
    case "gcp":
      return gcpKmsProvider();
    default:
      return localAeadProvider();
  }
}

/**
 * Resolve the 32-byte AES key for the local provider.
 *   - KMS_MASTER_KEY set → base64-decoded; must be ≥32 bytes (first 32 used).
 *   - unset → derived from the dev sentinel via SHA-256. config.productionFatals
 *     already refuses KMS_PROVIDER=local in production, so this dev fallback can
 *     never run there.
 */
function localMasterKey(): Buffer {
  const raw = config.KMS_MASTER_KEY;
  if (!raw) {
    return crypto.createHash("sha256").update(KNOWN_DEV_KMS_KEY).digest();
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new AppError(ErrorCode.INTERNAL, "KMS_MASTER_KEY is not valid base64");
  }
  if (decoded.length < 32) {
    throw new AppError(ErrorCode.INTERNAL, "KMS_MASTER_KEY must decode to at least 32 bytes");
  }
  return decoded.subarray(0, 32);
}

/** AES-256-GCM envelope using a server-held master key. Dev/test only (see header). */
export function localAeadProvider(): KeyVaultProvider {
  const key = localMasterKey();
  return {
    async wrap(plaintext: string, context: { aad: string }): Promise<string> {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context.aad, "utf8"));
      const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return (
        WRAP_PREFIX +
        [iv, tag, ct].map((b) => b.toString("base64url")).join(".")
      );
    },
    async unwrap(wrapped: string, context: { aad: string }): Promise<string> {
      if (!wrapped.startsWith(WRAP_PREFIX)) {
        throw new AppError(ErrorCode.INTERNAL, "Value is not a wrapped key");
      }
      const parts = wrapped.slice(WRAP_PREFIX.length).split(".");
      if (parts.length !== 3) {
        throw new AppError(ErrorCode.INTERNAL, "Malformed wrapped key");
      }
      const iv = Buffer.from(parts[0]!, "base64url");
      const tag = Buffer.from(parts[1]!, "base64url");
      const ct = Buffer.from(parts[2]!, "base64url");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(context.aad, "utf8"));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      } catch {
        // GCM auth failure: tamper, wrong master key, or AAD mismatch. Never
        // fall back to returning the ciphertext as if it were plaintext.
        throw new AppError(ErrorCode.INTERNAL, "Key unwrap failed (auth tag mismatch)");
      }
    },
  };
}

function notImplemented(name: string): KeyVaultProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `${name} KMS provider is not wired in this prototype — implement wrap/unwrap against the real KMS`
    );
  };
  return { wrap: fail, unwrap: fail };
}

/** Production swap target — wrap/unwrap delegate to AWS KMS. Stub for now. */
export function awsKmsProvider(): KeyVaultProvider {
  return notImplemented("aws");
}

/** Discriminator segment for gcp-wrapped blobs: gcm.v1.gcp.<ct> */
const GCP_SCHEME = "gcp";
const GCP_PREFIX = WRAP_PREFIX + GCP_SCHEME + ".";

/**
 * REAL GCP provider — wrap/unwrap via Cloud KMS symmetric encrypt/decrypt.
 *
 * The crypto key lives in KMS (hardware-backed, never exported); the DB stores
 * only KMS ciphertext, closing invariant *m* for real (not just encryption-at-rest
 * under a server-held master key). `context.aad` is passed as KMS
 * additionalAuthenticatedData, preserving the row-binding guarantee.
 *
 * The @google-cloud/kms client is lazy-required so `tsc`/vitest run without the
 * dep installed (mirrors the Temporal/Conductor adapters). Credentials resolve via
 * ADC — GOOGLE_APPLICATION_CREDENTIALS locally, the attached service account on
 * Cloud Run/GKE. KMS_KEY_NAME must be the full cryptoKey resource name.
 */
export function gcpKmsProvider(opts?: { keyName?: string; client?: KmsClient }): KeyVaultProvider {
  const keyName = opts?.keyName ?? config.KMS_KEY_NAME;
  if (!keyName) {
    throw new AppError(
      ErrorCode.INTERNAL,
      "KMS_PROVIDER=gcp requires KMS_KEY_NAME (projects/.../cryptoKeys/...)"
    );
  }

  // Lazily constructed, then cached across calls. A test may inject a fake client.
  let clientPromise: Promise<KmsClient> | null = opts?.client ? Promise.resolve(opts.client) : null;
  const getClient = (): Promise<KmsClient> => {
    if (!clientPromise) {
      clientPromise = (async () => {
        let mod: { KeyManagementServiceClient: new () => KmsClient };
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          mod = require("@google-cloud/kms");
        } catch {
          throw new AppError(
            ErrorCode.INTERNAL,
            "@google-cloud/kms is not installed — `npm i @google-cloud/kms` to use the gcp KMS provider"
          );
        }
        return new mod.KeyManagementServiceClient();
      })();
    }
    return clientPromise;
  };

  return {
    async wrap(plaintext: string, context: { aad: string }): Promise<string> {
      const client = await getClient();
      const [res] = await client.encrypt({
        name: keyName,
        plaintext: Buffer.from(plaintext, "utf8"),
        additionalAuthenticatedData: Buffer.from(context.aad, "utf8"),
      });
      if (!res.ciphertext) {
        throw new AppError(ErrorCode.INTERNAL, "GCP KMS encrypt returned no ciphertext");
      }
      return GCP_PREFIX + Buffer.from(res.ciphertext).toString("base64url");
    },
    async unwrap(wrapped: string, context: { aad: string }): Promise<string> {
      if (!wrapped.startsWith(GCP_PREFIX)) {
        throw new AppError(ErrorCode.INTERNAL, "Value is not a gcp-wrapped key");
      }
      const ciphertext = Buffer.from(wrapped.slice(GCP_PREFIX.length), "base64url");
      const client = await getClient();
      const [res] = await client.decrypt({
        name: keyName,
        ciphertext,
        additionalAuthenticatedData: Buffer.from(context.aad, "utf8"),
      });
      if (!res.plaintext) {
        // AAD mismatch, wrong key, or tamper — KMS refuses. Never fall through.
        throw new AppError(ErrorCode.INTERNAL, "GCP KMS decrypt returned no plaintext");
      }
      return Buffer.from(res.plaintext).toString("utf8");
    },
  };
}

/** Minimal shape of the Cloud KMS client we use (avoids a hard type dep). */
interface KmsClient {
  encrypt(req: {
    name: string;
    plaintext: Buffer;
    additionalAuthenticatedData?: Buffer;
  }): Promise<[{ ciphertext?: Uint8Array | string | null }]>;
  decrypt(req: {
    name: string;
    ciphertext: Buffer;
    additionalAuthenticatedData?: Buffer;
  }): Promise<[{ plaintext?: Uint8Array | string | null }]>;
}
