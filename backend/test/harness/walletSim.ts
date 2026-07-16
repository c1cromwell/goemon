/**
 * Ephemeral ES256 wallet stand-in (Secure Enclave equivalent for harness).
 * Phase 0: stub that can mint a keypair + did:key.
 * Phase 1: full VP JWT signing (lift from goemon-agent + backend didKey).
 */

import { generateKeyPair, exportJWK, type KeyLike, type JWK } from "jose";

export interface WalletSim {
  walletDid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

/**
 * Create an in-memory P-256 wallet. did:key encoding is completed in Phase 1
 * via backend `publicJwkToDidKey`; until then we use a placeholder DID derived
 * from the JWK x coordinate so callers can wire setup without crashing.
 */
export async function createWalletSim(): Promise<WalletSim> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const x = typeof publicJwk.x === "string" ? publicJwk.x.slice(0, 16) : "pending";
  // Placeholder until Phase 1 wires real did:key (p256 multicodec).
  const walletDid = `did:key:harness-pending:${x}`;
  return { walletDid, privateKey, publicJwk };
}

/** Phase 1: sign a VP JWT binding vcJwt to nonce + aud. */
export async function signPresentation(
  _wallet: WalletSim,
  _opts: { nonce: string; vcJwt: string; aud: string }
): Promise<string> {
  throw new Error("walletSim.signPresentation is implemented in Phase 1 (J6)");
}
