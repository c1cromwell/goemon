/**
 * Backend client for the external agent.
 *
 * Two trust contexts:
 *   - a one-time USER session (password login) used ONLY during account linking
 *     to issue the VC, bind the wallet did:key, and create the grant — the things
 *     the portal + iOS wallet would normally do. It is not retained for operations.
 *   - the OID4VP path (challenge → present → MCP), which carries NO user session:
 *     trust is the VP signature + nonce + grant, exactly as a real third party.
 */

const API = "http://localhost:3001/api";
const MCP = "http://localhost:3001/mcp";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function http<T>(url: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? "ERROR", data?.error?.message ?? res.statusText, res.status);
  }
  return data as T;
}

// ---- Linking (one-time, user session) -------------------------------------
export const link = {
  loginPassword: (email: string, password: string) =>
    http<{ userId: string; token: string }>(`${API}/auth/login/password`, {
      method: "POST",
      body: { email, password },
    }),
  getCredential: (token: string) =>
    http<{ jwt: string; allowedOps: string[]; revoked: boolean }>(`${API}/credentials/me`, { token }),
  issueCredential: (token: string) => http<{ jwt: string }>(`${API}/credentials/issue`, { method: "POST", token }),
  bindWallet: (token: string, walletDid: string) =>
    http<{ bound: boolean }>(`${API}/credentials/bind-wallet`, { method: "POST", token, body: { walletDid } }),
  grant: (
    token: string,
    body: { agentDid: string; displayName: string; allowedFunctions: string[]; maxTransferMinor: string }
  ) => http<{ active: boolean }>(`${API}/my-agents`, { method: "POST", token, body }),
};

// ---- OID4VP + MCP (no user session) ---------------------------------------
export interface Challenge {
  nonce: string;
  aud: string;
  scope: string[];
  expiresAt: string;
}
export interface ScopedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string[];
  jti: string;
}
export interface McpTool {
  name: string;
  description: string;
  requiredScope: string;
}

export const present = {
  challenge: (clientDid: string, scope: string[]) =>
    http<Challenge>(`${API}/present/challenge`, { method: "POST", body: { clientDid, scope } }),
  submit: (vpJwt: string) => http<ScopedTokenResponse>(`${API}/present`, { method: "POST", body: { vpJwt } }),
};

export const mcp = {
  tools: () => http<{ tools: McpTool[] }>(`${MCP}/tools`),
  call: (token: string, body: { tool: string; args: Record<string, unknown>; callId: string }) =>
    http<{ ok: boolean; tool: string; result: unknown }>(`${MCP}/call`, { method: "POST", token, body }),
};
