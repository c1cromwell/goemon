/**
 * BankAI API client (Phase 9 — full customer portal).
 *
 * Two independent token stores:
 *   - the ADMIN token (getToken/setToken/clearToken) used by the Phase 5A admin
 *     console — names preserved so those pages are untouched;
 *   - the USER session token used by the customer portal.
 *
 * Money-mutating POSTs auto-attach an `Idempotency-Key` (the backend requires it
 * and replays the original result on the same key). Errors surface a stable
 * `code` so callers can branch (e.g. NOT_IMPLEMENTED → password auth disabled).
 */

import { newIdempotencyKey } from "../lib/idempotency";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001/api";

const ADMIN_TOKEN_KEY = "bankai_admin_token";
const USER_TOKEN_KEY = "bankai_user_token";

// ---- Admin token (unchanged surface used by AdminLogin/AdminConsole) --------
export function getToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

// ---- User session token -----------------------------------------------------
export function getUserToken(): string | null {
  return localStorage.getItem(USER_TOKEN_KEY);
}
export function setUserToken(token: string): void {
  localStorage.setItem(USER_TOKEN_KEY, token);
}
export function clearUserToken(): void {
  localStorage.removeItem(USER_TOKEN_KEY);
}

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

interface HttpOpts {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** When set, attaches an Idempotency-Key header (money mutations). */
  idempotencyKey?: string;
}

async function http<T>(path: string, opts: HttpOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code ?? "ERROR";
    const message = data?.error?.message ?? res.statusText;
    throw new ApiError(code, message, res.status);
  }
  return data as T;
}

/** User-authenticated request (GET/non-money POSTs). */
function uget<T>(path: string): Promise<T> {
  return http<T>(path, { token: getUserToken() });
}
function upost<T>(path: string, body?: unknown): Promise<T> {
  return http<T>(path, { method: "POST", body, token: getUserToken() });
}
/** Money-mutating POST: requires/forwards an idempotency key. */
function umoney<T>(path: string, body: unknown, key: string): Promise<T> {
  return http<T>(path, { method: "POST", body, token: getUserToken(), idempotencyKey: key });
}

// ============================================================================
// Shared types (mirror the backend route/service response shapes)
// ============================================================================
export interface MoneyJSON {
  amount: string;
  currency: string;
}
export interface Me {
  id: string;
  email: string;
  fullName: string | null;
}
export interface Balances {
  cash: MoneyJSON;
  savings: MoneyJSON;
}
export interface Transaction {
  id: string;
  journalId: string;
  type: string;
  amountMinor: string;
  currency: string;
  description: string;
  createdAt: string;
}
export interface IdentityProfile {
  id: string;
  user_id: string;
  identity_status: string;
  tier: number;
  risk_tier: string;
  kyc_reference: string | null;
  sanctions_clear: number | null;
  initiated_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Passkey {
  id: string;
  credentialId: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface SessionView {
  id: string;
  status: string;
  decision: string | null;
  pii_confidence: number | null;
  required_steps: string[];
  scores: { email: number | null; ip: number | null; device: number | null; behavior: number | null };
  signals: Record<string, unknown>;
  decided_tier: number | null;
  decided_risk_tier: string | null;
  orchestrator: string;
  rationale: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  agent_runs: Array<{
    agent_type: string;
    status: string;
    confidence_before: number | null;
    confidence_after: number | null;
    output: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
  }>;
}

// SmartChat
export interface OperationTokenView {
  id: string;
  operation: string;
  scope: string[];
  status: "pending" | "awaiting_mfa" | "executed" | "failed" | "expired";
  mfaRequired: boolean;
  mfaVerified: boolean;
  metadata: Record<string, unknown>;
  result: unknown | null;
  expiresAt: string;
  createdAt: string;
}
export interface SmartChatResult {
  reply: string;
  intent: { operation: string; amountMinor?: string | null; currency?: string; recipient?: string | null };
  operationToken: OperationTokenView | null;
  requiresMfa: boolean;
  devMfaCode?: string;
}

// Internal agents
export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  type: string;
  permissions: string; // JSON array string
  transfer_limit_minor: number;
  currency: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

// External agent grants (my-agents)
export interface Grant {
  agentDid: string;
  displayName: string;
  description: string | null;
  allowedFunctions: string[];
  maxTransferMinor: string;
  currency: string;
  active: boolean;
  grantedAt: string;
  lastUsedAt: string | null;
}

// Credentials
export interface Credential {
  id: string;
  jwt: string;
  didSubject: string;
  allowedOps: string[];
  revoked: boolean;
  revokeReason: string | null;
  issuedAt: string;
  expiresAt: string;
}

// Marketplace
export type Surface = "invest" | "collect";
export interface ListingView {
  assetId: string;
  version: number;
  surface: Surface;
  priceMinor: string;
  currency: string;
  priceSource: string;
  priceAsOf: string;
  status: string;
  ddOutcome: string | null;
  name: string;
  symbol: string | null;
  kind: string;
  minTier: number;
  eligible: boolean;
  eligibilityReason?: string;
}
export interface AssetDetail {
  asset: {
    id: string;
    name: string;
    symbol: string | null;
    kind: string;
    tokenStandard: string;
    decimals: number;
    minTier: number;
    isSecurity: boolean;
    metadata: Record<string, unknown>;
    totalSupply: string;
    status: string;
  };
  listing: {
    assetId: string;
    version: number;
    surface: Surface;
    priceMinor: string;
    currency: string;
    priceSource: string;
    priceAsOf: string;
    status: string;
    ddOutcome: string | null;
  } | null;
}
export interface Holding {
  assetId: string;
  name: string;
  symbol: string | null;
  kind: string;
  qtyBase: string;
  priceMinor: string | null;
  valueMinor: string | null;
  currency: string | null;
}
export interface Portfolio {
  cashMinor: string;
  holdings: Holding[];
  holdingsValueMinor: string;
  totalValueMinor: string;
}
export interface Quote {
  side: "buy" | "sell" | "subscribe";
  assetId: string;
  qtyBase: string;
  priceMinor: string;
  currency: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  priceSource: string;
  priceAsOf: string;
  stale: boolean;
}
export interface OrderResult {
  orderId: string;
  status: string;
  side: string;
  assetId: string;
  qtyBase: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  currency: string;
  journalId: string | null;
}

// Hedera
export interface HederaAccount {
  hederaAccountId: string;
  publicKey?: string;
  network: string;
  usdcAssociated: boolean;
}
export interface HederaBalance {
  onChain: { hbarTinybars: string; usdcMicro: string };
  ledger: { usdcCash: string };
}

// ============================================================================
// User portal API
// ============================================================================
export const userApi = {
  // --- auth ---
  register: (email: string, password: string, fullName?: string) =>
    http<{ userId: string; token: string }>("/auth/register", {
      method: "POST",
      body: { email, password, fullName },
    }),
  loginPassword: (email: string, password: string) =>
    http<{ userId: string; token: string }>("/auth/login/password", {
      method: "POST",
      body: { email, password },
    }),
  me: () => uget<Me>("/auth/me"),

  /**
   * Feature-probe for password auth. The backend rejects with NOT_IMPLEMENTED
   * before reading the body when ALLOW_PASSWORD_AUTH is off, and with VALIDATION
   * (empty body) when it's on — neither path records an auth failure.
   */
  passwordAuthEnabled: async (): Promise<boolean> => {
    try {
      await http("/auth/login/password", { method: "POST", body: {} });
      return true;
    } catch (e) {
      return e instanceof ApiError ? e.code !== "NOT_IMPLEMENTED" : false;
    }
  },

  webauthnRegisterStart: () => upost<Record<string, unknown>>("/auth/webauthn/register/start"),
  webauthnRegisterFinish: (response: unknown, deviceName?: string) =>
    upost<{ verified: boolean }>("/auth/webauthn/register/finish", { response, deviceName }),
  webauthnAuthStart: (email: string) =>
    http<Record<string, unknown> & { challengeId: string }>("/auth/webauthn/authenticate/start", {
      method: "POST",
      body: { email },
    }),
  webauthnAuthFinish: (challengeId: string, response: unknown) =>
    http<{ userId: string; token: string }>("/auth/webauthn/authenticate/finish", {
      method: "POST",
      body: { challengeId, response },
    }),
  listPasskeys: () => uget<Passkey[]>("/auth/passkeys"),
  deletePasskey: (id: string) => http<void>(`/auth/passkeys/${id}`, { method: "DELETE", token: getUserToken() }),

  // --- accounts ---
  balance: () => uget<Balances>("/accounts/balance"),
  transactions: (limit = 50) => uget<Transaction[]>(`/accounts/transactions?limit=${limit}`),
  transfer: (toUserId: string, amountMinor: string, key: string, opts?: { currency?: string; description?: string }) =>
    umoney<{ journalId: string; transactionId: string }>(
      "/accounts/transfer",
      { toUserId, amountMinor, currency: opts?.currency ?? "USD", description: opts?.description },
      key
    ),

  // --- identity ---
  profile: () => uget<IdentityProfile>("/identity/profile"),
  tier1: (phone: string) => upost<IdentityProfile>("/identity/tier1", { phone }),
  tier2Start: (fullName: string, dob: string, country?: string) =>
    upost<{ kyc_reference: string }>("/identity/tier2/start", { fullName, dob, country }),
  tier2Complete: () => upost<IdentityProfile>("/identity/tier2/complete"),
  kycStatus: () => uget<{ status: string; tier: number; kyc_reference: string | null }>("/identity/tier2/status"),

  // --- onboarding (risk-adaptive) ---
  onboardingStart: (body?: { deviceFingerprint?: string; rapidCompletion?: boolean }) =>
    upost<SessionView>("/onboarding/start", body ?? {}),
  onboardingDocument: (body: { documentNumber: string; documentType?: string; fullName?: string; dob?: string; country?: string }) =>
    upost<SessionView>("/onboarding/document", body),
  onboardingPossession: (body: { code?: string; factor?: "email_otp" | "sms_otp" | "device" }) =>
    upost<SessionView>("/onboarding/possession", body),
  onboardingStatus: () => uget<SessionView>("/onboarding/status"),

  // --- smartchat ---
  smartchat: (message: string) => upost<SmartChatResult>("/smartchat", { message }),
  smartchatMfa: (tokenId: string, code: string, key: string) =>
    umoney<SmartChatResult>(`/smartchat/tokens/${tokenId}/mfa`, { code }, key),
  operationTokens: (limit?: number) =>
    uget<OperationTokenView[]>(`/smartchat/tokens${limit ? `?limit=${limit}` : ""}`),

  // --- internal agents ---
  agents: () => uget<AgentRow[]>("/agents"),
  createAgent: (body: { name: string; description?: string; permissions?: string[]; transfer_limit_minor?: number; expires_at?: string }) =>
    upost<AgentRow>("/agents", body),
  updateAgent: (id: string, body: Record<string, unknown>) =>
    http<AgentRow>(`/agents/${id}`, { method: "PATCH", body, token: getUserToken() }),
  deleteAgent: (id: string) => http<void>(`/agents/${id}`, { method: "DELETE", token: getUserToken() }),

  // --- external agent grants ---
  grants: () => uget<{ grants: Grant[] }>("/my-agents"),
  grantAgent: (body: { agentDid: string; displayName: string; description?: string; allowedFunctions: string[]; maxTransferMinor: string; currency?: string }) =>
    upost<{ agentDid: string; allowedFunctions: string[]; maxTransferMinor: string; active: boolean }>("/my-agents", body),
  revokeGrant: (agentDid: string, reason?: string) =>
    upost<{ revoked: boolean }>(`/my-agents/${encodeURIComponent(agentDid)}/revoke`, { reason }),

  // --- credentials ---
  credential: () => uget<Credential>("/credentials/me"),
  issueCredential: () => upost<{ id: string }>("/credentials/issue"),
  revokeCredential: (credentialId: string, reason?: string) =>
    upost<{ revoked: boolean }>(`/credentials/${credentialId}/revoke`, { reason }),

  // --- marketplace ---
  listings: (surface?: Surface) =>
    uget<{ listings: ListingView[] }>(`/marketplace/listings${surface ? `?surface=${surface}` : ""}`),
  portfolio: () => uget<Portfolio>("/marketplace/portfolio"),
  asset: (id: string) => uget<AssetDetail>(`/marketplace/assets/${id}`),
  quote: (assetId: string, side: "buy" | "sell" | "subscribe", qtyBase: string) =>
    upost<Quote>("/marketplace/quote", { assetId, side, qtyBase }),
  subscribe: (assetId: string, qtyBase: string, key: string) =>
    umoney<OrderResult>(`/marketplace/assets/${assetId}/subscribe`, { qtyBase }, key),
  order: (assetId: string, side: "buy" | "sell", qtyBase: string, key: string) =>
    umoney<OrderResult>("/marketplace/orders", { assetId, side, qtyBase }, key),

  // --- hedera (conditional; 404/NOT_IMPLEMENTED when disabled) ---
  hederaAccount: () => uget<HederaAccount>("/hedera/account"),
  createHederaAccount: () => upost<HederaAccount>("/hedera/account"),
  hederaBalance: () => uget<HederaBalance>("/hedera/balance"),
  hederaTransfer: (body: { toUserId?: string; toHederaAccountId?: string; amountMicro: string }, key: string) =>
    umoney<{ txId: string; journalId: string }>("/hedera/transfer", body, key),
};

export { newIdempotencyKey };

// ============================================================================
// Admin API (Phase 5A — unchanged surface, admin token)
// ============================================================================
async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code ?? "ERROR";
    const message = body?.error?.message ?? res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return body as T;
}

export interface IdentitySummary {
  user_id: string;
  email: string;
  full_name: string | null;
  is_simulated: boolean;
  tier: number;
  identity_status: string;
  risk_tier: string;
  session_status: string | null;
  decision: string | null;
  pii_confidence: number | null;
  created_at: string;
}

export interface ReviewItem {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  pii_confidence: number | null;
  decision: string | null;
  created_at: string;
}

export const api = {
  login: (email: string, password: string) =>
    adminRequest<{ token: string; role: string }>("/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  seed: () => adminRequest<{ created: boolean; email: string }>("/admin/seed", { method: "POST" }),
  identities: () => adminRequest<IdentitySummary[]>("/admin/identities"),
  identityDetail: (userId: string) => adminRequest<Record<string, unknown>>(`/admin/identities/${userId}`),
  reviewQueue: () => adminRequest<ReviewItem[]>("/admin/onboarding/sessions?status=review_required"),
  decide: (sessionId: string, approve: boolean) =>
    adminRequest(`/admin/onboarding/sessions/${sessionId}/decision`, { method: "POST", body: JSON.stringify({ approve }) }),
  simulate: (profiles?: string[]) =>
    adminRequest<{ results: Array<{ profile: string; decision: string; status: string; expected: string }> }>(
      "/admin/simulations",
      { method: "POST", body: JSON.stringify({ profiles }) }
    ),
};
