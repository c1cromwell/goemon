/**
 * Simulated wallet bridge — the browser stand-in for the Phase 10 iOS wallet.
 *
 * Holds an ES256 (P-256) key (the "Secure Enclave" equivalent) and signs
 * Verifiable Presentations locally. In the real product this key lives on the
 * user's device and Face ID gates each signature; here the agent app owns it so
 * the OID4VP → MCP flow is demonstrable end-to-end in a single browser.
 *
 * The public key is published as a did:key and bound to the user's VC server-side
 * (holder binding); the backend resolves the DID to verify every VP signature.
 */
import { generateKeyPair, exportJWK, importJWK, SignJWT, type KeyLike, type JWK } from "jose";
import { publicJwkToDidKey } from "./didKey";

const STORE = "goeman_agent_wallet";

let cached: { priv: KeyLike; walletDid: string } | null = null;

async function loadOrCreate(): Promise<{ priv: KeyLike; walletDid: string }> {
  if (cached) return cached;

  const raw = localStorage.getItem(STORE);
  if (raw) {
    const { privateJwk, walletDid } = JSON.parse(raw) as { privateJwk: JWK; walletDid: string };
    const priv = (await importJWK(privateJwk, "ES256")) as KeyLike;
    cached = { priv, walletDid };
    return cached;
  }

  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const pubJwk = await exportJWK(publicKey);
  const privJwk = await exportJWK(privateKey);
  const walletDid = publicJwkToDidKey(pubJwk);
  localStorage.setItem(STORE, JSON.stringify({ privateJwk: privJwk, walletDid }));
  cached = { priv: (await importJWK(privJwk, "ES256")) as KeyLike, walletDid };
  return cached;
}

/** The wallet's did:key (creating the key on first call). */
export async function getWalletDid(): Promise<string> {
  return (await loadOrCreate()).walletDid;
}

/** Sign a Verifiable Presentation binding the VC to a one-time nonce + audience. */
export async function signPresentation(opts: { nonce: string; vcJwt: string; aud: string }): Promise<string> {
  const { priv, walletDid } = await loadOrCreate();
  return new SignJWT({
    nonce: opts.nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: walletDid,
      verifiableCredential: [opts.vcJwt],
    },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(walletDid)
    .setAudience(opts.aud)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(priv);
}

export function resetWallet(): void {
  localStorage.removeItem(STORE);
  cached = null;
}
