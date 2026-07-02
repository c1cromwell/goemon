/**
 * Goemon Global Finance API client (Phase 9 — full customer portal).
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

const ADMIN_TOKEN_KEY = "goemon_admin_token";
const ADMIN_ROLE_KEY = "goemon_admin_role";
const USER_TOKEN_KEY = "goemon_user_token";

// ---- Admin token (unchanged surface used by AdminLogin/AdminConsole) --------
export function getToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
export function setAdminRole(role: string): void {
  localStorage.setItem(ADMIN_ROLE_KEY, role);
}
export function getAdminRole(): string | null {
  return localStorage.getItem(ADMIN_ROLE_KEY);
}
export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_ROLE_KEY);
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
  account_type?: string;
  is_minor?: number;
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
export type SlabGrader = "psa" | "bgs" | "sgc" | "cgc";
export type SlabCategory = "sports" | "pokemon";
export type SubmissionStatus = "pending_cert" | "pending_human" | "approved" | "rejected";

export interface CertPreview {
  verified: boolean;
  source: string;
  grader: SlabGrader;
  certNumber: string;
  cardDescription?: string;
  grade?: string;
  year?: string;
  brand?: string;
  subject?: string;
  imageUrl?: string;
}

export interface SellerSubmission {
  id: string;
  sellerUserId: string;
  category: SlabCategory;
  grader: SlabGrader;
  certNumber: string;
  title: string | null;
  description: string | null;
  askUsdcMicro: string;
  imageUrls: string[];
  certVerified: boolean;
  certSource: string | null;
  cert: CertPreview;
  comp: { priceMinor: string; source: string | null; asOf: string | null } | null;
  aiGrade: { source: string; predictedGrade?: string; confidence?: number; notes?: string } | null;
  status: SubmissionStatus;
  rejectionReason: string | null;
  assetId: string | null;
  createdAt: string;
}

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
  purchaseMode?: "escrow" | "instant";
  collectiblesEscrowEnabled?: boolean;
  activePurchase?: {
    id: string;
    status: CollectiblePurchaseStatus;
    buyerUserId: string;
    sellerUserId: string;
  } | null;
}
export type CollectiblePurchaseStatus = "escrow_held" | "shipped" | "completed" | "refunded" | "disputed";
export interface CollectiblePurchase {
  id: string;
  assetId: string;
  buyerUserId: string;
  sellerUserId: string;
  escrowId: string;
  amountMinor: string;
  currency: string;
  status: CollectiblePurchaseStatus;
  shippedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

// Escrow & dispute layer
export type EscrowStatus = "held" | "disputed" | "released" | "refunded";
export interface EscrowView {
  id: string;
  payerId: string;
  payeeId: string;
  payerEmail?: string;
  payeeEmail?: string;
  amountMinor: string;
  currency: string;
  status: EscrowStatus;
  memo: string | null;
  disputeReason: string | null;
  resolution: "release" | "refund" | null;
  createdAt: string;
}

// Trading (Phase 17 Stage 1 — isolated; 503 TRADING_DISABLED when off)
export interface Instrument {
  symbol: string;
  kind: string;
  displayName: string;
  currency: string;
  lastPriceMinor: string;
  minOptionsLevel: number;
}
export interface TradeOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qtyBase: string;
  status: string;
  rejectReason: string | null;
  createdAt: string;
}
export interface TradePosition {
  symbol: string;
  qtyBase: string;
}

// Hedera
export interface HederaAccount {
  hederaAccountId: string;
  evmAddress?: string;
  publicKey?: string;
  network: string;
  usdcAssociated: boolean;
}
export interface HederaBalance {
  onChain: { hbarTinybars: string; usdcMicro: string };
  ledger: { usdcCash: string };
}

export interface CctpTransfer {
  id: string;
  direction: string;
  source_chain: string;
  dest_chain: string;
  amount_micro: string;
  status: string;
  external_ref: string | null;
}

export interface PayMerchant {
  id: string;
  ownerUserId: string;
  name: string;
  status: string;
  createdAt: string;
}

export interface PaymentIntent {
  id: string;
  merchantId: string;
  merchantName: string;
  amountMinor: string;
  currency: string;
  memo: string | null;
  status: string;
  payerUserId: string | null;
  escrowId: string | null;
  expiresAt: string;
  createdAt: string;
}

// FX (currency registry + quote + cross-currency settlement)
export interface FxCurrency {
  code: string;
  decimals: number;
  kind: "fiat" | "stablecoin";
  enabled: boolean;
  label: string;
}
export interface FxQuoteResult {
  from: string;
  to: string;
  fromAmountMinor: string;
  toAmountMinor: string;
  rate: string;
  ratePpm: string;
  source: string;
  asOf: string;
  stale: boolean;
}
export interface FxConversion {
  id: string;
  from: string;
  to: string;
  fromAmountMinor: string;
  grossToMinor: string;
  feeMinor: string;
  toAmountMinor: string;
  rate: string;
  spreadBps: number;
  source: string;
  journalId: string;
}

/** Login-less checkout challenge (POST /pay/intents/:id/checkout/challenge). */
export interface CheckoutChallenge {
  nonce: string;
  aud: string;
  scope: string[];
  expiresAt: string;
  intentId: string;
  amountMinor: string;
  currency: string;
  merchantName: string;
  memo: string | null;
}

// USDC → fiat off-ramp
export interface OffRampQuote {
  provider: string; usdcAmountMinor: string; feeMinor: string; usdcNetMinor: string;
  fiatAmountMinor: string; fiatCurrency: string; asset: string; ratePpm: number; feeBps: number;
}
export interface OffRampOrder {
  id: string; provider: string; status: string;
  usdcAmountMinor: string; feeMinor: string; usdcNetMinor: string;
  fiatAmountMinor: string; fiatCurrency: string; asset: string; ratePpm: string;
  destination: string | null; externalRef: string | null; journalId: string | null;
  createdAt: string; completedAt: string | null;
}

// Fiat → USDC on-ramp
export interface OnRampQuote {
  provider: string; fiatAmountMinor: string; fiatCurrency: string; asset: string;
  usdcGrossMinor: string; feeMinor: string; usdcNetMinor: string; ratePpm: number; feeBps: number;
}
export interface OnRampOrder {
  id: string; provider: string; status: string;
  fiatAmountMinor: string; fiatCurrency: string; asset: string;
  usdcGrossMinor: string; feeMinor: string; usdcNetMinor: string; ratePpm: number;
  externalRef: string | null; redirectUrl: string | null; journalId: string | null;
  createdAt: string; completedAt: string | null;
}

// Collateralized lending
export interface BorrowingPower {
  collateralValueMinor: string; maxBorrowMinor: string; aprBps: number; maxLtvBps: number;
}
export interface Loan {
  id: string; userId: string; collateralAssetId: string; collateralQtyBase: string;
  borrowCurrency: string; principalMinor: string; principalOutstandingMinor: string;
  accruedInterestMinor: string; outstandingMinor: string; collateralValueMinor: string;
  healthFactorBps: number; aprBps: number; maxLtvBps: number; liquidationLtvBps: number;
  status: string; openedAt: string; closedAt: string | null;
}

// X-Money response F1–F6 types
export interface TreasuryPosition {
  assetId: string;
  symbol: string;
  qtyBase: string;
  valueMinor: string;
  apyBps: number;
  recentAccruals: Array<{ per_unit_minor: string | number; holders_paid: number; total_minor: string | number; as_of: string }>;
}
export interface SelfCustodyReport {
  selfCustodied: { walletDid: string | null; serverHoldsWalletKey: boolean; hedera: { accountId: string; evmAddress: string | null; publicKey: string | null; network: string; serverHoldsKey: boolean } | null };
  custodial: { cashMinor: string; currency: string; note: string };
  frozen: boolean;
  guarantee: string[];
}
export interface PaymentRequest {
  id: string; requesterUserId: string; fromUserId: string | null; amountMinor: string; currency: string;
  memo: string | null; status: string; fulfilledBy: string | null; journalId: string | null; expiresAt: string; createdAt: string;
}
export interface Drop {
  id: string; assetId: string; creatorUserId: string; name: string; editionSize: number; priceMinor: string;
  currency: string; memo: string | null; certNumber: string | null; claimedCount: number; status: string; createdAt: string;
}
export interface CrossBorderSend {
  id: string; senderUserId: string; recipientUserId: string; from: string; to: string;
  fromAmountMinor: string; grossToMinor: string; feeMinor: string; toAmountMinor: string; rate: string; spreadBps: number; source: string; journalId: string;
}
export interface CardReward { id: string; auth_id: string; amount_minor: string; currency: string; created_at: string }

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
  // The backend returns the stored passkey on success and THROWS (non-2xx) on a
  // failed verification — there is no `verified` flag in the success body.
  webauthnRegisterFinish: (response: unknown, deviceName?: string) =>
    upost<{ passkeyId: string; credentialId: string }>("/auth/webauthn/register/finish", { response, deviceName }),
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

  // --- seller collectibles (slab P2P) ---
  verifySlabCert: (grader: SlabGrader, certNumber: string) =>
    upost<{ cert: CertPreview }>("/collectibles/verify-cert", { grader, certNumber }),
  submitCollectible: (body: {
    category: SlabCategory;
    grader: SlabGrader;
    certNumber: string;
    askUsdcMicro: string;
    title?: string;
    description?: string;
    imageUrls?: string[];
    runAiPreGrade?: boolean;
  }) => upost<{ submission: SellerSubmission }>("/collectibles/submissions", body),
  myCollectibleSubmissions: () => uget<{ submissions: SellerSubmission[] }>("/collectibles/submissions/mine"),

  purchaseCollectible: (assetId: string, key: string) =>
    umoney<{ purchase: CollectiblePurchase }>("/collectibles/purchase", { assetId }, key),
  collectiblePurchases: (limit?: number) =>
    uget<{ purchases: CollectiblePurchase[] }>(`/collectibles/purchases${limit ? `?limit=${limit}` : ""}`),
  collectiblePurchase: (id: string) => uget<{ purchase: CollectiblePurchase }>(`/collectibles/purchases/${id}`),
  shipCollectiblePurchase: (id: string) => upost<{ purchase: CollectiblePurchase }>(`/collectibles/purchases/${id}/ship`),
  confirmCollectiblePurchase: (id: string) => upost<{ purchase: CollectiblePurchase }>(`/collectibles/purchases/${id}/confirm`),
  cancelCollectiblePurchase: (id: string) => upost<{ purchase: CollectiblePurchase }>(`/collectibles/purchases/${id}/cancel`),
  disputeCollectiblePurchase: (id: string, reason: string) =>
    upost<{ purchase: CollectiblePurchase }>(`/collectibles/purchases/${id}/dispute`, { reason }),

  // --- escrow & dispute ---
  escrows: () => uget<EscrowView[]>("/escrow"),
  escrowHold: (body: { payeeEmail?: string; payeeId?: string; amountMinor: string; currency?: string; memo?: string }, key: string) =>
    umoney<EscrowView>("/escrow", body, key),
  escrowRelease: (id: string) => upost<EscrowView>(`/escrow/${id}/release`),
  escrowRefund: (id: string) => upost<EscrowView>(`/escrow/${id}/refund`),
  escrowDispute: (id: string, reason: string) => upost<EscrowView>(`/escrow/${id}/dispute`, { reason }),

  // --- trading (Phase 17 Stage 1) ---
  instruments: () => uget<Instrument[]>("/trading/instruments"),
  tradeOrders: (limit = 25) => uget<TradeOrder[]>(`/trading/orders?limit=${limit}`),
  positions: () => uget<TradePosition[]>("/trading/positions"),
  placeTrade: (body: { symbol: string; side: "buy" | "sell"; type?: "market" | "limit"; qtyBase: string; limitPriceMinor?: string }, key: string) =>
    umoney<TradeOrder>("/trading/orders", body, key),

  // --- hedera (conditional; 404/NOT_IMPLEMENTED when disabled) ---
  hederaAccount: () => uget<HederaAccount>("/hedera/account"),
  createHederaAccount: () => upost<HederaAccount>("/hedera/account"),
  hederaBalance: () => uget<HederaBalance>("/hedera/balance"),
  hederaTransfer: (body: { toUserId?: string; toHederaAccountId?: string; amountMicro: string }, key: string) =>
    umoney<{ txId: string; journalId: string }>("/hedera/transfer", body, key),
  registerPushDevice: (body: { platform: "ios" | "android" | "web"; token: string }) =>
    upost<{ registered: boolean }>("/hedera/devices", body),
  cctpTransfer: (
    body: { direction: "in" | "out"; sourceChain: string; destChain?: string; amountMicro: string },
    key: string
  ) => umoney<{ id: string; status: string; externalRef: string }>("/hedera/cctp", body, key),
  cctpTransfers: () => uget<{ transfers: CctpTransfer[] }>("/hedera/cctp"),
  pollInbound: () => upost<{ newEvents: number }>("/hedera/poll-inbound"),

  // --- Goemon Pay (Phase 21 merchant wedge) ---
  payMerchants: () => uget<PayMerchant[]>("/pay/merchants"),
  createPayMerchant: (name: string) => upost<PayMerchant>("/pay/merchants", { name }),
  payIntents: (role: "merchant" | "payer" = "merchant") => uget<PaymentIntent[]>(`/pay/intents?role=${role}`),
  createPayIntent: (
    body: { merchantId: string; amountMinor: string; currency?: string; memo?: string },
    key: string
  ) => umoney<PaymentIntent>("/pay/intents", body, key),
  payIntent: (id: string, key: string) => umoney<PaymentIntent>(`/pay/intents/${id}/pay`, {}, key),
  capturePayIntent: (id: string) => upost<PaymentIntent>(`/pay/intents/${id}/capture`),

  // --- FX (currency exchange): quote is read-only, convert moves money ---
  fxCurrencies: () => uget<{ currencies: FxCurrency[] }>("/fx/currencies"),
  fxQuote: (from: string, to: string, amountMinor: string) =>
    upost<FxQuoteResult>("/fx/quote", { from, to, amountMinor }),
  fxConvert: (from: string, to: string, fromAmountMinor: string, key: string) =>
    umoney<FxConversion>("/fx/convert", { from, to, fromAmountMinor }, key),
  fxConversions: () => uget<{ conversions: FxConversion[] }>("/fx/conversions"),

  // --- login-less checkout via Verifiable Credential (Phase 21) ---
  // bindWallet uses the session (one-time device link); the two checkout calls
  // deliberately send NO token — trust is the VP signature, not a login.
  bindWallet: (walletDid: string) =>
    upost<{ bound: boolean; walletDid: string }>("/credentials/bind-wallet", { walletDid }),
  checkoutChallenge: (intentId: string) =>
    http<CheckoutChallenge>(`/pay/intents/${intentId}/checkout/challenge`, { method: "POST", body: {} }),
  payWithPresentation: (intentId: string, vpJwt: string) =>
    http<{ intent: PaymentIntent; payer: { userId: string; walletDid: string }; authorizedVia: string }>(
      `/pay/intents/${intentId}/pay-with-presentation`,
      { method: "POST", body: { vpJwt } }
    ),

  // --- bank rails (Phase 19) ---
  bankTransfers: () => uget<{ transfers: BankTransfer[] }>("/bank/transfers"),
  bankDeposit: (amountMinor: string, key: string, currency = "USD") =>
    umoney<BankTransferResult>("/bank/deposit", { amountMinor, currency }, key),
  bankWithdraw: (body: { amountMinor: string; currency?: string; method?: "ach" | "wire" | "instant"; destination?: string }, key: string) =>
    umoney<BankTransferResult>("/bank/withdraw", body, key),
  bankStatement: (from: string, to: string, currency = "USD") =>
    uget<Statement>(`/bank/statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&currency=${currency}`),
  bankAccounts: () => uget<{ accounts: BankAccount[] }>("/bank/accounts"),
  linkBankAccount: (body: { label?: string; type?: "checking" | "savings"; last4: string; routing?: string }) =>
    upost<BankAccount>("/bank/accounts", body),

  // --- cards (Phase 19.4) ---
  cards: () => uget<{ cards: Card[] }>("/cards"),
  issueCard: () => upost<Card>("/cards"),
  cardAuthorizations: () => uget<{ authorizations: CardAuth[] }>("/cards/authorizations"),
  cardAuthorize: (cardId: string, amountMinor: string, key: string, merchant?: string) =>
    umoney<CardAuth>(`/cards/${cardId}/authorize`, { amountMinor, merchant }, key),
  cardVoid: (authId: string) => upost<{ voided: boolean }>(`/cards/authorizations/${authId}/void`),
  cardRewards: () => uget<{ totalMinor: string; currency: string; rewards: CardReward[] }>("/cards/rewards"),

  // --- Fiat → USDC on-ramp (buy USDC with fiat — the activation gap) ---
  onrampQuote: (fiatAmountMinor: string) => upost<OnRampQuote>("/onramp/quote", { fiatAmountMinor }),
  onrampOrder: (fiatAmountMinor: string, key: string) => umoney<OnRampOrder>("/onramp/order", { fiatAmountMinor }, key),
  onrampOrders: () => uget<OnRampOrder[]>("/onramp/orders"),

  // --- USDC → fiat off-ramp (cash out — the exit door) ---
  offrampQuote: (usdcAmountMinor: string) => upost<OffRampQuote>("/offramp/quote", { usdcAmountMinor }),
  offrampOrder: (usdcAmountMinor: string, destination: string | undefined, key: string) =>
    umoney<OffRampOrder>("/offramp/order", { usdcAmountMinor, destination }, key),
  offrampOrders: () => uget<OffRampOrder[]>("/offramp/orders"),

  // --- Collateralized lending (borrow against holdings) ---
  lendingQuote: (collateralAssetId: string, collateralQtyBase: string) =>
    upost<BorrowingPower>("/lending/quote", { collateralAssetId, collateralQtyBase }),
  openLoan: (collateralAssetId: string, collateralQtyBase: string, borrowMinor: string, key: string) =>
    umoney<Loan>("/lending/loans", { collateralAssetId, collateralQtyBase, borrowMinor }, key),
  loans: () => uget<Loan[]>("/lending/loans"),
  repayLoan: (loanId: string, amountMinor: string, key: string) =>
    umoney<Loan>(`/lending/loans/${loanId}/repay`, { amountMinor }, key),

  // --- X-Money response F1 — tokenized Treasury (Earn) ---
  treasury: () => uget<TreasuryPosition>("/treasury"),
  treasurySubscribe: (qtyBase: string, key: string) => umoney<{ assetId: string; qtyBase: string; costMinor: string }>("/treasury/subscribe", { qtyBase }, key),
  treasuryRedeem: (qtyBase: string, key: string) => umoney<{ assetId: string; qtyBase: string; proceedsMinor: string }>("/treasury/redeem", { qtyBase }, key),

  // --- F2 — self-custody & portability ---
  selfCustody: () => uget<SelfCustodyReport>("/self-custody/report"),
  selfCustodyExport: () => uget<{ manifest: Record<string, unknown>; signedManifestJwt: string }>("/self-custody/export"),

  // --- F3 — P2P money requests ---
  payRequests: (role: "sent" | "received") => uget<PaymentRequest[]>(`/requests?role=${role}`),
  createPayRequest: (body: { from?: string; amountMinor: string; currency?: string; memo?: string }) => upost<PaymentRequest>("/requests", body),
  fulfillPayRequest: (id: string, key: string) => umoney<PaymentRequest>(`/requests/${id}/fulfill`, {}, key),
  declinePayRequest: (id: string) => upost<PaymentRequest>(`/requests/${id}/decline`),
  cancelPayRequest: (id: string) => upost<PaymentRequest>(`/requests/${id}/cancel`),

  // --- F5 — collector/creator drops ---
  drops: (mine?: boolean) => uget<{ drops: Drop[] }>(`/drops${mine ? "?mine=1" : ""}`),
  drop: (id: string) => uget<Drop>(`/drops/${id}`),
  createDrop: (body: { name: string; symbol?: string; editionSize: number; priceMinor: string; currency?: string; memo?: string; certNumber?: string }) => upost<Drop>("/drops", body),
  claimDrop: (id: string, key: string) => umoney<{ dropId: string; editionNumber: number; assetId: string; journalId: string; status: string }>(`/drops/${id}/claim`, {}, key),
  myDropClaims: () => uget<{ claims: Array<{ drop_id: string; edition_number: number; name: string; asset_id: string; created_at: string }> }>("/drops/claims"),

  // --- F6 — cross-border send ---
  crossBorderQuote: (from: string, to: string, amountMinor: string) => upost<FxQuoteResult>("/cross-border/quote", { from, to, amountMinor }),
  crossBorderSend: (body: { recipient: string; from: string; to: string; fromAmountMinor: string }, key: string) => umoney<CrossBorderSend>("/cross-border/send", body, key),
  crossBorderSends: () => uget<{ sends: CrossBorderSend[] }>("/cross-border/sends"),

  // --- bill pay (Phase 19.3) ---
  billPayees: () => uget<{ payees: BillPayee[] }>("/billpay/payees"),
  addBillPayee: (body: { name: string; category?: string; last4?: string }) => upost<BillPayee>("/billpay/payees", body),
  billPayments: () => uget<{ payments: BillPayment[] }>("/billpay/payments"),
  payBill: (body: { payeeId: string; amountMinor: string; recurrence?: "none" | "weekly" | "monthly"; scheduledFor?: string }, key: string) =>
    umoney<{ paymentId: string; status: string }>("/billpay/pay", body, key),
  cancelBill: (id: string) => upost<{ canceled: boolean }>(`/billpay/payments/${id}/cancel`),

  // --- Goemon Starter (Phase 22.0) ---
  starterHousehold: () => uget<{ household: StarterHousehold | null }>("/starter/household"),
  createStarterHousehold: (name?: string) => upost<{ household: StarterHousehold }>("/starter/household", name ? { name } : {}),
  starterDashboard: () => uget<StarterGuardianDashboard>("/starter/household/dashboard"),
  starterTeens: () => uget<{ teens: StarterTeenSummary[] }>("/starter/household/teens"),
  addStarterTeen: (body: { email: string; fullName: string; dob: string }) =>
    upost<{ teen: StarterTeenSummary }>("/starter/household/teens", body),
  issueTeenCard: (teenId: string) => upost<{ card: Card }>(`/starter/teens/${teenId}/card`),
  updateTeenSpendPolicy: (teenId: string, body: { dailyLimitMinor?: string; blockedMerchants?: string[] }) =>
    http(`/starter/teens/${teenId}/spend-policy`, { method: "PUT", body, token: getUserToken() }),
  starterReviews: () => uget<{ reviews: StarterReview[] }>("/starter/reviews"),
  decideStarterReview: (id: string, decision: "approve" | "reject", reason?: string) =>
    upost<{ status: string }>(`/starter/reviews/${id}/decide`, { decision, reason }),
  freezeTeen: (teenId: string, reason?: string) => upost<{ frozen: boolean }>(`/starter/teens/${teenId}/freeze`, { reason }),
  unfreezeTeen: (teenId: string, reason?: string) => upost<{ frozen: boolean }>(`/starter/teens/${teenId}/unfreeze`, { reason }),
  starterSavings: () => uget<StarterSavingsOverview>("/starter/savings"),
  createSavingsGoal: (name: string, targetMinor: string) =>
    upost<{ goal: SavingsGoal }>("/starter/savings/goals", { name, targetMinor }),
  depositSavings: (amountMinor: string, goalId: string | undefined, key: string) =>
    umoney<{ journalId: string; match?: { matchMinor: string } | null }>("/starter/savings/deposit", { amountMinor, goalId }, key),
  starterGamification: () => uget<GamificationState>("/starter/gamification"),
  starterCheckIn: () => upost<{ currentCount: number }>("/starter/gamification/check-in"),
  completeStarterLesson: (lessonId: string, score = 100) =>
    upost<{ completed: boolean }>(`/starter/gamification/lessons/${lessonId}/complete`, { score }),
  starterCoach: () => uget<StarterCoachDashboard>("/starter/coach"),
};

// --- Phase 19 row/result types (snake_case mirrors the backend rows) ---
export interface BankTransfer {
  id: string; direction: "in" | "out"; method: string; amount_minor: string; currency: string;
  status: string; counterparty: string | null; external_ref: string | null; created_at: string; settled_at: string | null;
}
export interface BankTransferResult { transferId: string; journalId: string; status: string; externalRef: string }
export interface BankAccount { id: string; label: string | null; type: string; masked_number: string; routing: string | null; status: string; created_at: string }
export interface StatementLine { date: string; description: string; direction: "debit" | "credit"; amountMinor: string; signedMinor: string }
export interface Statement { currency: string; from: string; to: string; openingMinor: string; closingMinor: string; lines: StatementLine[] }
export interface Card { id: string; network: string; masked_number: string; exp_month: number; exp_year: number; currency: string; status: string; created_at: string }
export interface CardAuth { id: string; card_id: string; merchant: string | null; amount_minor: string; currency: string; status: string; created_at: string }
export interface BillPayee { id: string; name: string; category: string | null; masked_account: string | null; status: string; created_at: string }
export interface BillPayment {
  id: string; payee_id: string; amount_minor: string; currency: string; status: string; recurrence: string;
  scheduled_for: string; created_at: string; sent_at: string | null;
}

export interface StarterHousehold {
  id: string;
  guardianUserId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface StarterTeenSummary {
  userId: string;
  email: string;
  fullName: string | null;
  dob: string;
  tier: number;
  identityStatus: string;
  balances: { cash: string; savings: string; currency: string };
  allowedOps: string[];
}
export interface StarterGuardianDashboard {
  household: StarterHousehold;
  teens: StarterTeenSummary[];
  pendingApprovals: number;
  coachInsights: Array<{ id: string; teenUserId: string; insightType: string; summary: string; createdAt: string }>;
}
export interface StarterReview {
  id: string;
  skill: string;
  subject_user_id: string | null;
  status: string;
  recommendation: string;
  reason: string;
  created_at: string;
}
export interface SavingsGoal {
  id: string;
  user_id: string;
  name: string;
  target_minor: string;
  allocated_minor: string;
  status: string;
}
export interface StarterSavingsOverview {
  balances: { cash: string; savings: string };
  goals: SavingsGoal[];
  settings: { apy_bps: number; guardian_match_bps: number; savings_locked: number } | null;
}
export interface GamificationState {
  quests: Array<{ id: string; title: string; description: string; status: string }>;
  streaks: Array<{ streakType: string; currentCount: number; lastTickDate: string | null }>;
  badges: string[];
  lessons: Array<{ id: string; title: string; completed: boolean; score: number | null }>;
  netWorth: { cashMinor: string; savingsMinor: string; totalMinor: string; projectedMonthly: string[] };
}
export interface StarterCoachDashboard {
  nudge: string;
  spending: { summary: string; topMerchants: string[] };
  savings: { recommendation: string };
}

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
  seed: () => adminRequest<{
    admin: { created: boolean; email: string };
    ceo: { created: boolean; email: string };
    cs: { created: boolean; email: string };
    accounts: Array<{ email: string; password: string; role: string }>;
  }>("/admin/seed", { method: "POST" }),
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

  // --- escrow dispute mediation (compliance/admin) ---
  escrowDisputes: () => adminRequest<EscrowView[]>("/admin/escrow/disputes"),
  resolveEscrow: (id: string, outcome: "release" | "refund") =>
    adminRequest<EscrowView>(`/admin/escrow/${id}/resolve`, { method: "POST", body: JSON.stringify({ outcome }) }),

  // --- seller collectible human review ---
  collectibleReviews: () => adminRequest<{ submissions: SellerSubmission[] }>("/admin/collectibles/reviews"),
  approveCollectible: (id: string) =>
    adminRequest<{ submission: SellerSubmission; assetId: string }>(`/admin/collectibles/reviews/${id}/approve`, { method: "POST" }),
  rejectCollectible: (id: string, reason: string) =>
    adminRequest<{ submission: SellerSubmission }>(`/admin/collectibles/reviews/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // --- M2 Agentic OS CEO approvals ---
  agentApprovals: () => adminRequest<{ reviews: AgentReviewRow[] }>("/admin/agent-ops/approvals"),
  agentReviewDecision: (id: string, decision: "approve" | "reject", reason?: string) =>
    adminRequest(`/admin/agent-ops/reviews/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, reason: reason || undefined }),
    }),
  milestones: () => adminRequest<{ milestones: MilestoneStatus[] }>("/admin/agent-ops/milestones"),
  signMilestone: (id: string, note?: string) =>
    adminRequest<{ milestone: MilestoneStatus }>(`/admin/agent-ops/milestones/${id}/signoff`, {
      method: "POST",
      body: JSON.stringify({ note: note || undefined }),
    }),
  kgRecent: (limit = 25) => adminRequest<{ decisions: KgNode[] }>(`/admin/agent-ops/kg/recent?limit=${limit}`),
  kgWorkflow: (workflowRun: string) => adminRequest<KgGraph>(`/admin/agent-ops/kg/workflow/${workflowRun}`),
  kgExport: (scope?: "corporate" | "product") =>
    adminRequest<KgGraph>(`/admin/agent-ops/kg/export${scope ? `?scope=${scope}` : ""}`),

  modelRegistry: () =>
    adminRequest<{ registry: ModelRegistryEntry[]; routing: ModelRoutingPreview[] }>("/admin/agent-ops/models/registry"),
  modelInvocations: (limit = 25) =>
    adminRequest<{ invocations: ModelInvocationRow[] }>(`/admin/agent-ops/models/invocations?limit=${limit}`),
  modelStats: () => adminRequest<ModelInvocationStats>("/admin/agent-ops/models/stats"),

  corporateAgents: () => adminRequest<{ agents: CorporateAgentDef[] }>("/admin/agent-ops/corporate/agents"),
  corporatePreviewRoute: (intent: string, payload?: Record<string, unknown>) =>
    adminRequest<{ route: CorporateRoutePlan }>("/admin/agent-ops/corporate/preview-route", {
      method: "POST",
      body: JSON.stringify({ intent, payload }),
    }),
  corporateRun: (agentId: string, input?: Record<string, unknown>) =>
    adminRequest<AgentRunResult>("/admin/agent-ops/corporate/run", {
      method: "POST",
      body: JSON.stringify({ agentId, input }),
    }),
  corporateRoute: (intent: string, payload?: Record<string, unknown>) =>
    adminRequest<AgentRunResult>("/admin/agent-ops/corporate/route", {
      method: "POST",
      body: JSON.stringify({ intent, payload }),
    }),

  productSquadAgents: () => adminRequest<{ agents: ProductSquadAgentDef[] }>("/admin/agent-ops/product/agents"),
  productPdlcRun: (product: string, version?: string, summary?: string) =>
    adminRequest<AgentRunResult>("/admin/agent-ops/product/pdlc", {
      method: "POST",
      body: JSON.stringify({ product, version, summary }),
    }),
  productSquadRun: (agentId: string, input?: Record<string, unknown>) =>
    adminRequest<AgentRunResult>("/admin/agent-ops/product/run", {
      method: "POST",
      body: JSON.stringify({ agentId, input }),
    }),
  kgProduct: (limit = 100) => adminRequest<KgGraph>(`/admin/agent-ops/kg/product?limit=${limit}`),
};

export interface KgNode {
  id: string;
  nodeType: string;
  title: string;
  body: Record<string, unknown>;
  scope: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface KgEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KgGraph {
  nodes: KgNode[];
  edges: KgEdge[];
  exportedAt: string;
}

export interface AgentReviewRow {
  id: string;
  skill: string;
  status: string;
  requires_role: string;
  reason: string | null;
  gate_category: string | null;
  output_class: string | null;
  workflow_run: string;
  created_at: string;
  recommendation: string;
}

export interface MilestoneStatus {
  id: string;
  title: string;
  description: string;
  signed: boolean;
  signedAt: string | null;
  approverRole: string | null;
  note: string | null;
}

export interface ModelRegistryEntry {
  id: string;
  vendor: string;
  tier: string;
  model: string;
  contextWindow: number;
  inputMicroUsdPer1k: number;
  outputMicroUsdPer1k: number;
  latencyClass: string;
  enabled: boolean;
}

export interface ModelRoutingPreview {
  taskClass: string;
  tier: string;
  primaryModel: string;
  vendor: string;
}

export interface ModelInvocationRow {
  id: string;
  taskClass: string;
  modelId: string;
  vendor: string;
  skill: string | null;
  workflowRun: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  status: string;
  errorCode: string | null;
  createdAt: string;
}

export interface ModelInvocationStats {
  totalInvocations: number;
  totalCostMicroUsd: number;
  byTaskClass: Record<string, { count: number; costMicroUsd: number }>;
}

export interface CorporateAgentDef {
  id: string;
  name: string;
  charter: string;
  skill: string;
  supervision: string;
  ceoGate?: string;
  reused?: boolean;
}

export interface CorporateRoutePlan {
  targetSkill: string;
  targetInput: Record<string, unknown>;
  rationale: string;
  agentId: string;
  confidence: number;
}

export interface AgentRunResult {
  runId: string;
  workflowRun: string;
  outcome: "executed" | "queued" | "rejected";
  reviewId?: string;
}

export interface ProductSquadAgentDef {
  id: string;
  name: string;
  charter: string;
  skill: string;
  supervision: string;
  ceoGate?: string;
  pdlcPhase?: string;
  reused?: boolean;
}

// Pre-launch waitlist — public, no auth. Idempotent on email server-side.
export const waitlistApi = {
  join: (email: string, source?: string) =>
    http<{ ok: boolean }>("/waitlist", { method: "POST", body: { email, source } }),
};

// Issuance console (Phase 29 P1).
export interface IssuerAssetType {
  kind: string;
  defaultTokenStandard: string;
  isSecurity: boolean;
  complianceProfile: string;
  label: string;
  enabled: boolean;
}
export interface IssuerComplianceProfile {
  name: string;
  label: string;
  description: string;
  dimensions: string[];
}
export interface IssuerOptions {
  enabled: boolean;
  assetTypes: IssuerAssetType[];
  complianceProfiles: IssuerComplianceProfile[];
}
export interface IssuedAsset {
  id: string;
  kind: string;
  name: string;
  symbol: string | null;
  tokenStandard: string;
  isSecurity: boolean;
  totalSupply: string;
  status?: string;
}
export interface IssueAssetInput {
  kind: string;
  name: string;
  symbol?: string;
  decimals?: number;
  complianceProfile?: string;
  minTier?: number;
  jurisdictionAllow?: string[];
  holderCap?: number;
  whitelist?: string[];
  metadata?: Record<string, unknown>;
  initialSupply: string;
  listing?: { surface: "invest" | "collect"; priceMinor: string; priceSource?: string };
}
export const issuerApi = {
  options: () => uget<IssuerOptions>("/issuer/options"),
  mine: () => uget<{ assets: IssuedAsset[] }>("/issuer/assets"),
  create: (body: IssueAssetInput, key: string) =>
    umoney<{ asset: IssuedAsset; listed: boolean; complianceProfile: string }>("/issuer/assets", body, key),
};

// Holder portfolio / investment-management tools (Phase 29 P3).
export interface PortfolioHolding {
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
  holdings: PortfolioHolding[];
  holdingsValueMinor: string;
  totalValueMinor: string;
}
export interface Distribution {
  journalId: string;
  label: string;
  description: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
}
export interface TaxSummary {
  year: number;
  count: number;
  totalsByCurrency: Record<string, string>;
  byAsset: { label: string; currency: string; totalMinor: string }[];
  disclaimer: string;
}
export const portfolioApi = {
  positions: () => uget<Portfolio>("/portfolio"),
  distributions: () => uget<{ distributions: Distribution[] }>("/portfolio/distributions"),
  taxSummary: (year: number) => uget<TaxSummary>(`/portfolio/tax-summary?year=${year}`),
};

// Employee equity compensation (Phase 29 P4).
export interface EquityGrantView {
  id: string;
  assetId: string;
  assetName?: string | null;
  assetSymbol?: string | null;
  awardType: "unit_award" | "profits_interest" | "option";
  unitsTotal: string;
  unitsReleased: string;
  vested: string;
  releasable: string;
  exercisable: string;
  exercisePriceMinor: string;
  thresholdMinor: string;
  currency: string;
  vestStart: string;
  cliffMonths: number;
  durationMonths: number;
  eightyThreeBFiled: boolean;
  eightyThreeBDeadline: string | null;
  status: string;
}
export const equityApi = {
  mine: () => uget<{ grants: EquityGrantView[] }>("/equity/grants"),
  release: (id: string) => upost<EquityGrantView>(`/equity/grants/${id}/release`),
  exercise: (id: string, qty: string, key: string) =>
    umoney<EquityGrantView>(`/equity/grants/${id}/exercise`, { qty }, key),
  file83b: (id: string) => upost<EquityGrantView>(`/equity/grants/${id}/file-83b`),
};
