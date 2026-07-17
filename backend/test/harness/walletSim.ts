/**
 * Ephemeral ES256 wallet stand-in (Secure Enclave equivalent for harness).
 * Uses backend `publicJwkToDidKey` so DID encoding matches presentationService.
 */

import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from "jose";
import { v4 as uuidv4 } from "uuid";
import { publicJwkToDidKey } from "../../src/utils/didKey";

export interface WalletSim {
  walletDid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

/** Create an in-memory P-256 wallet with a real `did:key:z…`. */
export async function createWalletSim(): Promise<WalletSim> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const walletDid = publicJwkToDidKey(publicJwk);
  return { walletDid, privateKey, publicJwk };
}

/**
 * Sign a VP JWT binding vcJwt to a one-time nonce + audience.
 * `signKey` overrides the wallet key (used for VP_INVALID / wrong-key cases).
 */
export async function signPresentation(
  wallet: WalletSim,
  opts: {
    nonce: string;
    vcJwt: string;
    aud: string;
    signKey?: KeyLike;
    jti?: string;
  }
): Promise<string> {
  return new SignJWT({
    nonce: opts.nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: wallet.walletDid,
      verifiableCredential: [opts.vcJwt],
    },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(wallet.walletDid)
    .setAudience(opts.aud)
    .setJti(opts.jti ?? uuidv4())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(opts.signKey ?? wallet.privateKey);
}
