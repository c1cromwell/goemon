/**
 * Phase 20 — Hedera transaction signing seam (custody escalation above key-vault).
 *
 * HEDERA_SIGNER selects HOW a user's transaction is signed:
 *   - "keyvault" (default) — the wrapped key is unwrapped (keyVaultService) and the
 *     transaction is signed in-process. Encryption-at-rest custody; behavior-preserving.
 *   - "hsm" — the private key NEVER enters the process: signing is delegated to an HSM
 *     backend (PKCS#11 / cloud-HSM) via Hedera's signWith(publicKey, signer). The server
 *     holds only a key reference + the public key. The real PKCS#11 backend is the
 *     production swap; setHsmBackend() injects it (and a test double).
 *   - "ondevice" — the non-custodial target: the server holds NO key and cannot sign;
 *     the signature must be produced on the user's device. Server-side signing throws.
 *
 * Only the per-user signing path is covered here; the operator/paymaster key has its own
 * env/vault custody (see hederaService.resolveOperatorKey).
 */

import { PrivateKey, PublicKey } from "@hashgraph/sdk";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { getKeyVault } from "./keyVaultService";
import type { HederaAccountRow } from "./hederaService";

/** A frozen Hedera transaction supports both in-process and external signing. */
interface SignableTx {
  sign(key: PrivateKey): Promise<unknown>;
  signWith(publicKey: PublicKey, signer: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<unknown>;
}

/** Produces a signature for `data` without exposing the private key (HSM / cloud-HSM). */
export interface HsmBackend {
  sign(keyRef: string, data: Uint8Array): Promise<Uint8Array>;
}

let hsmBackend: HsmBackend | null = null;

/** Inject the HSM backend (PKCS#11/cloud-HSM in prod; a test double in tests). */
export function setHsmBackend(backend: HsmBackend | null): void {
  hsmBackend = backend;
}

function requireHsmBackend(): HsmBackend {
  if (!hsmBackend) {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      "HEDERA_SIGNER=hsm but no HSM backend is configured (PKCS#11/cloud-HSM is the production swap)"
    );
  }
  return hsmBackend;
}

/**
 * Resolve a user's signing key from its custody-wrapped form (keyvault mode only).
 *   - private_key_enc present → unwrap (AAD-bound to the userId).
 *   - legacy private_key_hex only → use once, then lazily re-encrypt (self-healing).
 */
export async function loadSignerKey(account: HederaAccountRow): Promise<PrivateKey> {
  if (account.private_key_enc) {
    const der = await getKeyVault().unwrap(account.private_key_enc, { aad: account.user_id });
    return PrivateKey.fromStringDer(der);
  }
  if (account.private_key_hex) {
    const key = PrivateKey.fromStringDer(account.private_key_hex);
    const enc = await getKeyVault().wrap(account.private_key_hex, { aad: account.user_id });
    await getDb().execute(
      "UPDATE hedera_accounts SET private_key_enc = ?, private_key_hex = NULL WHERE id = ?",
      [enc, account.id]
    );
    return key;
  }
  throw new AppError(ErrorCode.NOT_FOUND, "Account has no signing key material");
}

/** True when an account row carries usable signing material (wrapped, legacy, or HSM-referenced). */
export function hasSignerKey(account: HederaAccountRow | null): boolean {
  if (!account) return false;
  if (config.HEDERA_SIGNER === "hsm") return !!account.public_key; // key lives in the HSM
  return !!(account.private_key_enc || account.private_key_hex);
}

export interface HederaSigner {
  mode: "keyvault" | "hsm" | "ondevice";
  /** Sign a frozen transaction, returning the signed transaction. */
  signTransaction<T extends SignableTx>(tx: T): Promise<T>;
}

function keyVaultSigner(account: HederaAccountRow): HederaSigner {
  return {
    mode: "keyvault",
    async signTransaction<T extends SignableTx>(tx: T): Promise<T> {
      const key = await loadSignerKey(account);
      await tx.sign(key);
      return tx;
    },
  };
}

function hsmSignerFor(account: HederaAccountRow): HederaSigner {
  if (!account.public_key) throw new AppError(ErrorCode.NOT_FOUND, "Account has no public key for HSM signing");
  const keyRef = account.hedera_account_id ?? account.id;
  const publicKey = PublicKey.fromString(account.public_key);
  return {
    mode: "hsm",
    async signTransaction<T extends SignableTx>(tx: T): Promise<T> {
      // The key never enters the process — signWith hands the bytes to the HSM.
      await tx.signWith(publicKey, (bytes) => requireHsmBackend().sign(keyRef, bytes));
      return tx;
    },
  };
}

function onDeviceSigner(): HederaSigner {
  return {
    mode: "ondevice",
    async signTransaction<T extends SignableTx>(): Promise<T> {
      throw new AppError(
        ErrorCode.NOT_IMPLEMENTED,
        "HEDERA_SIGNER=ondevice: the server holds no key — the transaction must be signed on the user's device"
      );
    },
  };
}

/** The active signer for an account, per HEDERA_SIGNER. */
export function getHederaSigner(account: HederaAccountRow): HederaSigner {
  switch (config.HEDERA_SIGNER) {
    case "hsm":
      return hsmSignerFor(account);
    case "ondevice":
      return onDeviceSigner();
    default:
      return keyVaultSigner(account);
  }
}
