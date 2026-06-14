/**
 * Phase 20 — Hedera signing seam (keyvault / hsm / ondevice).
 *
 *   - keyvault (default): signs in-process with the unwrapped key (key vault is read).
 *   - hsm: signs via signWith → the injected HSM backend; the key vault is NEVER read
 *     (the private key never enters the process).
 *   - ondevice: server-side signing is refused (non-custodial).
 *
 * Uses a fake frozen transaction (sign/signWith spies) so the routing is verified
 * deterministically without a live Hedera client.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "fs";
import { PrivateKey } from "@hashgraph/sdk";
import { v4 as uuidv4 } from "uuid";
import { getHederaSigner, setHsmBackend, type HsmBackend } from "../src/services/signerService";
import * as keyVault from "../src/services/keyVaultService";
import { ErrorCode } from "../src/errors";
import type { HederaAccountRow } from "../src/services/hederaService";

const TMP_DB = `./data/test-signer-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  keyVault.initKeyVault();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

function fakeTx() {
  const tx = {
    sign: vi.fn(async () => tx),
    signWith: vi.fn(async (_pub: unknown, signer: (b: Uint8Array) => Promise<Uint8Array>) => {
      await signer(new Uint8Array([1, 2, 3])); // exercise the signer callback
      return tx;
    }),
  };
  return tx;
}

async function wrappedAccount(): Promise<HederaAccountRow> {
  const key = PrivateKey.generateED25519();
  const userId = uuidv4();
  const enc = await keyVault.getKeyVault().wrap(key.toStringDer(), { aad: userId });
  return {
    id: uuidv4(), user_id: userId, hedera_account_id: "0.0.999", evm_address: null,
    public_key: key.publicKey.toStringDer(), private_key_hex: null, private_key_enc: enc,
    usdc_associated: 0, network: "testnet", created_at: new Date().toISOString(),
  };
}

describe("HEDERA_SIGNER seam", () => {
  it("keyvault (default) signs in-process by unwrapping the key", async () => {
    const { config } = await import("../src/config");
    (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "keyvault";
    const account = await wrappedAccount();
    const tx = fakeTx();
    const signer = getHederaSigner(account);
    expect(signer.mode).toBe("keyvault");
    await signer.signTransaction(tx as never);
    expect(tx.sign).toHaveBeenCalledOnce();
    expect(tx.signWith).not.toHaveBeenCalled();
  });

  it("hsm signs via the backend and NEVER reads the key vault", async () => {
    const { config } = await import("../src/config");
    (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "hsm";
    const account = await wrappedAccount();

    const unwrapSpy = vi.spyOn(keyVault, "getKeyVault");
    const backend: HsmBackend = { sign: vi.fn(async () => new Uint8Array([9, 9, 9])) };
    setHsmBackend(backend);
    try {
      const tx = fakeTx();
      const signer = getHederaSigner(account);
      expect(signer.mode).toBe("hsm");
      await signer.signTransaction(tx as never);
      expect(tx.signWith).toHaveBeenCalledOnce();
      expect(tx.sign).not.toHaveBeenCalled();
      expect(backend.sign).toHaveBeenCalledWith("0.0.999", expect.any(Uint8Array)); // keyRef + bytes
      expect(unwrapSpy).not.toHaveBeenCalled(); // private key never entered the process
    } finally {
      setHsmBackend(null);
      unwrapSpy.mockRestore();
      (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "keyvault";
    }
  });

  it("hsm without a configured backend fails closed", async () => {
    const { config } = await import("../src/config");
    (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "hsm";
    const account = await wrappedAccount();
    try {
      await expect(getHederaSigner(account).signTransaction(fakeTx() as never)).rejects.toMatchObject({
        code: ErrorCode.NOT_IMPLEMENTED,
      });
    } finally {
      (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "keyvault";
    }
  });

  it("ondevice refuses server-side signing (non-custodial)", async () => {
    const { config } = await import("../src/config");
    (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "ondevice";
    const account = await wrappedAccount();
    try {
      const signer = getHederaSigner(account);
      expect(signer.mode).toBe("ondevice");
      await expect(signer.signTransaction(fakeTx() as never)).rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
    } finally {
      (config as { HEDERA_SIGNER: string }).HEDERA_SIGNER = "keyvault";
    }
  });
});
