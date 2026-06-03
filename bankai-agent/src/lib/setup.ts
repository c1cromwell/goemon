/**
 * One-time account linking — the demo stand-in for what the BankAI portal + iOS
 * wallet would do: prove who the user is (once), ensure they hold a VC, bind this
 * app's wallet did:key to that VC (holder binding), and create the user→agent
 * grant. After linking, the user session is discarded; all operations go through
 * the OID4VP path with no session.
 */
import { link as api, ApiError } from "./api";
import { getWalletDid, resetWallet } from "./wallet";
import { CLIENT_DID } from "./agent";

const LINK_STORE = "bankai_agent_link";

/** Scopes this agent requests at link time (subset the user can trim). */
export const REQUESTABLE_SCOPES = ["balance:read", "statement:read", "profile:read", "transfer:low"];

export interface LinkState {
  email: string;
  vcJwt: string;
  walletDid: string;
  scopes: string[];
}

export function getLink(): LinkState | null {
  const raw = localStorage.getItem(LINK_STORE);
  return raw ? (JSON.parse(raw) as LinkState) : null;
}

export function clearLink(): void {
  localStorage.removeItem(LINK_STORE);
  resetWallet();
}

export async function linkAccount(email: string, password: string, scopes: string[]): Promise<LinkState> {
  const { token } = await api.loginPassword(email, password);

  // Ensure the user holds a VC (issue one if missing).
  let vcJwt: string;
  try {
    vcJwt = (await api.getCredential(token)).jwt;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      vcJwt = (await api.issueCredential(token)).jwt;
    } else {
      throw e;
    }
  }

  // Bind this app's wallet key, then grant the agent.
  const walletDid = await getWalletDid();
  await api.bindWallet(token, walletDid);
  await api.grant(token, {
    agentDid: CLIENT_DID,
    displayName: "BankAI Assistant (demo agent)",
    allowedFunctions: scopes,
    maxTransferMinor: "50000",
  });

  const state: LinkState = { email, vcJwt, walletDid, scopes };
  localStorage.setItem(LINK_STORE, JSON.stringify(state));
  return state;
}
