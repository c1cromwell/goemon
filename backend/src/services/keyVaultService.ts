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
 *   - awsKmsProvider() / gcpKmsProvider() — interface stubs for the production swap.
 *                            They throw NOT_IMPLEMENTED until real creds are wired;
 *                            the point is the seam (call sites never change).
 *
 * Mirrors the injectable-provider pattern in reconciliationService
 * (setChainBalanceProvider). Tests inject a fake via setKeyVaultProvider().
 *
 * Wrapped format (versioned, self-describing so legacy plaintext is unambiguous):
 *   gcm.v1.<ivB64url>.<tagB64url>.<ciphertextB64url>
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

/** Production swap target — wrap/unwrap delegate to GCP KMS. Stub for now. */
export function gcpKmsProvider(): KeyVaultProvider {
  return notImplemented("gcp");
}
