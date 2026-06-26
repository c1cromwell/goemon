/**
 * Phase 0 — Configuration.
 *
 * All environment variables are loaded and validated ONCE at boot via zod.
 * In production we fail fast (process.exit(1)) on missing/insecure config:
 *   - JWT_SECRET must not equal the known dev default.
 *   - ALLOW_PASSWORD_AUTH must not be enabled.
 * Import `config` anywhere; never read process.env directly elsewhere.
 */

import "dotenv/config";
import { z } from "zod";

const KNOWN_DEV_JWT_SECRET = "argus_dev_secret_change_in_production";
const KNOWN_DEV_FRAUD_KEY = "fraud_dev_key_change_in_production";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

// Like boolish but absent → true (opt-out rather than opt-in).
const boolishDefaultTrue = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? true : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  BASE_URL: z.string().url().default("http://localhost:3001"),
  CREDENTIAL_BASE_URL: z.string().url().default("http://localhost:3001"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  ANTHROPIC_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(1),

  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./data/argus.db"),
  REDIS_URL: z.string().optional(),

  ALLOW_PASSWORD_AUTH: boolish,
  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    ),

  RP_ID: z.string().default("localhost"),
  RP_NAME: z.string().default("Argus Financial Partners"),
  RP_ORIGIN: z.string().default("http://localhost:5173"),

  IDV_PROVIDER: z.enum(["simulated", "persona"]).default("simulated"),
  SANCTIONS_PROVIDER: z.enum(["simulated", "trm"]).default("simulated"),
  PERSONA_API_KEY: z.string().optional(),
  TRM_API_KEY: z.string().optional(),

  // Phase 5A — Agentic account opening (risk-adaptive onboarding).
  // The orchestrator that fuses signals into a confidence + required steps:
  //   "simulated" — deterministic rule-based fusion (offline, default, used in tests)
  //   "anthropic" — the @anthropic-ai/sdk scorer (advisory; guardrails still gate grants)
  ONBOARDING_ORCHESTRATOR: z.enum(["simulated", "anthropic"]).default("simulated"),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Phase 6 — SmartChat intent classifier:
  //   "simulated" — deterministic keyword/amount parser (offline, default, used in tests)
  //   "anthropic" — the @anthropic-ai/sdk classifier via structured tool-use
  // Either way the classifier is advisory: every money operation still flows through
  // an operation token, the MFA gate, and ledgerService.transfer.
  SMARTCHAT_ORCHESTRATOR: z.enum(["simulated", "anthropic"]).default("simulated"),
  // Confidence (0..1) at/above which onboarding auto-approves without step-up.
  ONBOARDING_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  // Floor below which onboarding is rejected even after sub-agent step-up.
  ONBOARDING_REVIEW_FLOOR: z.coerce.number().min(0).max(1).default(0.5),
  // Secret for signing admin-console JWTs. Distinct from JWT_SECRET (user sessions);
  // falls back to JWT_SECRET in dev. Must be set and distinct in production.
  ADMIN_JWT_SECRET: z.string().optional(),

  // Stage 1 fraud seam (docs/business/FraudEngine-GapAnalysis.md §5).
  //   FRAUD_ENGINE_ENABLED  — run the deterministic scorer + record a fraud_decision
  //                           on every money-path event (the "listen + decide + audit"
  //                           contract). Off = no scoring, no rows (escape hatch).
  //   FRAUD_ENGINE_ENFORCE  — when true, a `block` action throws FRAUD_BLOCKED. When
  //                           false the decision is still recorded but the transfer
  //                           proceeds (shadow mode — score live traffic, take no action).
  // The scorer is advisory; deterministic thresholds here are the only enforcement,
  // mirroring assessRisk→finalizeDecision in onboarding.
  FRAUD_ENGINE_ENABLED: boolishDefaultTrue,
  FRAUD_ENGINE_ENFORCE: boolishDefaultTrue,

  // Phase 20 — comprehensive fraud platform as a standalone ADD-ON service
  // (the `fraud-engine/` deployable; Stages 2–4 of FraudEngine.md). Argus talks
  // to it ONLY over HTTP via fraudClient — no shared code. A lightweight local
  // triage (the rules-v0 scorer) decides whether each money event is screened
  // synchronously (blocking) or emitted fire-and-forget; the remote score is
  // ADVISORY, the local deterministic gate + account freeze remain authoritative.
  //   FRAUD_ENGINE_URL       — base URL of the fraud engine (unset ⇒ client inert; local-only).
  //   FRAUD_ENGINE_API_KEY   — shared service bearer (engine validates it; engine reuses it to call back).
  //   FRAUD_REMOTE_ENABLED   — master switch for any call-out (default on, but inert without a URL).
  //   FRAUD_REMOTE_REQUIRED  — fail CLOSED when the engine is unreachable on the blocking path
  //                            (default off ⇒ degrade open: a missing engine never blocks money).
  FRAUD_ENGINE_URL: z.string().url().optional(),
  FRAUD_ENGINE_API_KEY: z.string().optional(),
  FRAUD_REMOTE_ENABLED: boolishDefaultTrue,
  FRAUD_REMOTE_REQUIRED: boolish,

  // Phase 17 Stage 1 — trading & brokerage seam. Off by default — a kill-switch that
  // disables all trading without touching the bank (docs/PHASE-17-TRADING-BROKERAGE.md).
  // The Stage-1 broker is SIMULATED only and must never run in production (see productionFatals).
  TRADING_ENABLED: boolish,

  // Phase 17 Stage 2 — market-data provider for trading quotes (CQRS read path).
  // Simulated default; polygon/iex are prod swaps requiring market-data licensing.
  MARKET_DATA_PROVIDER: z.enum(["simulated", "polygon", "iex"]).default("simulated"),

  // FX quote seam — currency conversion rates (quote-only; no money movement yet).
  // Off by default; a kill-switch gating the /api/fx quote surface. FX_RATE_PROVIDER
  // selects the rate source (simulated stand-in; circle/oanda are prod swaps). The
  // simulated provider must never run in production (see productionFatals).
  FX_ENABLED: boolish,
  FX_RATE_PROVIDER: z.enum(["simulated", "circle", "oanda"]).default("simulated"),

  // Cross-currency settlement (moves money: debits one currency, credits another with
  // a spread fee). Off by default; a separate kill-switch from quotes because it touches
  // the ledger. Prod-fatal while the rate provider is simulated. FX_SPREAD_BPS is the
  // fee charged on the converted amount (basis points; 50 = 0.50%).
  FX_SETTLEMENT_ENABLED: boolish,
  FX_SPREAD_BPS: z.coerce.number().int().nonnegative().max(10_000).default(50),

  // Phase 21 Stage 1 — "Argus Pay" native payment rail. Off by default — a kill-switch
  // that sheds new payment intents/payments without touching transfers or in-flight
  // escrows (docs/business/PAYMENT-NETWORK-STRATEGY.md §4/§8). The Stage-1 rail is a
  // prototype (money-transmission licensing pending) and must never run in production.
  ARGUS_PAY_ENABLED: boolish,

  // Phase 21 — login-less merchant checkout via Verifiable Presentation. Off by default.
  // When on, a customer can authorize a payment intent by presenting a VC-backed VP from
  // their device (no session/redirect login) — the VP proves the holder and binds to one
  // intent. Rides ARGUS_PAY_ENABLED for the actual money move, so it inherits that
  // prototype/prod posture; this flag only gates the two no-auth checkout routes.
  CHECKOUT_VP_ENABLED: boolish,

  // Phase 18.6 — tokenized 1:1-backed public equities (prototype seam). Off by default;
  // a kill-switch that gates new dividend/redemption endpoints. EQUITY_ISSUER selects the
  // backing/redemption provider (simulated stand-in; dinari/firstparty are prod swaps).
  EQUITIES_ENABLED: boolish,
  EQUITY_ISSUER: z.enum(["simulated", "dinari", "firstparty"]).default("simulated"),

  // X-Money response F1 — tokenized yield-bearing Treasury (prototype seam). Off by default;
  // a kill-switch (prod-fatal — it's a security; real launch needs issuer/transfer-agent/ATS +
  // counsel). The competitive counter to a custodial 6% APY: own a yield-bearing ASSET whose
  // yield is an automatic pro-rata distribution. TREASURY_APY_BPS is the annual rate (450 = 4.5%).
  TREASURY_ENABLED: boolish,
  TREASURY_APY_BPS: z.coerce.number().int().nonnegative().max(10_000).default(450),

  // Phase 19 Stage-1 — full-bank rails (fiat on/off-ramp + ACH/wire payouts). Off by
  // default; a kill-switch that gates deposits/withdrawals. BANK_RAIL_PROVIDER selects the
  // partner-bank provider (simulated stand-in; column/treasuryprime/unit are prod swaps).
  BANK_RAILS_ENABLED: boolish,
  BANK_RAIL_PROVIDER: z.enum(["simulated", "column", "treasuryprime", "unit"]).default("simulated"),

  // Phase 19.4 — debit cards (prototype seam). Off by default; a kill-switch gating card
  // issuance/auth. CARD_PROCESSOR selects the processor (simulated; marqeta/lithic/stripe stubs).
  CARDS_ENABLED: boolish,
  CARD_PROCESSOR: z.enum(["simulated", "marqeta", "lithic", "stripe"]).default("simulated"),

  // Phase 19.3 — bill pay (prototype seam). Off by default; a kill-switch gating payee
  // payments. Rides the BANK_RAIL_PROVIDER (bill pay is a directed payout to a biller).
  BILLPAY_ENABLED: boolish,

  // Phase 22 — Argus Starter (13+ family/teen suite). Off by default; a kill-switch
  // gating household/teen endpoints. Stages 22.0–22.3 are simulated; prod requires
  // partner bank, card issuer, COPPA counsel, etc.
  TEEN_ENABLED: boolish,

  // Phase 22.4 — credit-builder card + bureau reporting seam. Off by default; prod-fatal
  // until a credit-builder reporting partner + consumer-credit counsel land.
  TEEN_CREDIT_BUILDER_ENABLED: boolish,
  CREDIT_BUREAU_REPORTER: z.enum(["simulated", "step", "experian"]).default("simulated"),

  // Phase 22.5 — custodial investing (UGMA/UTMA). Off by default; prod-fatal until a
  // custodial broker-dealer + transfer agent + securities counsel land.
  TEEN_CUSTODIAL_ENABLED: boolish,
  CUSTODIAL_BROKER: z.enum(["simulated", "alpaca", "drivewealth"]).default("simulated"),

  HEDERA_ENABLED: boolish,
  HEDERA_NETWORK: z.enum(["testnet", "mainnet", "previewnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  HEDERA_USDC_TOKEN_ID: z.string().optional(),

  // Wallet extensions (competitive gap plan) — CCTP bridge, mirror polling, push, partners.
  CCTP_ENABLED: boolish,
  CCTP_PROVIDER: z.enum(["simulated", "circle"]).default("simulated"),
  MIRROR_SUBSCRIPTION_ENABLED: boolishDefaultTrue,
  MIRROR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  COLLECTIBLES_PROVIDER: z.enum(["simulated", "courtyard", "collectorcrypt"]).default("simulated"),
  TRAVEL_RULE_ENABLED: boolish,
  TRAVEL_RULE_PROVIDER: z.enum(["simulated", "notabene", "sumsub", "verifyvasp"]).default("simulated"),
  RWA_ISSUER_ENABLED: boolish,
  RWA_ISSUER_PROVIDER: z.enum(["simulated", "ondo", "securitize", "realt"]).default("simulated"),
  MECH_GOV_ENABLED: boolishDefaultTrue,

  // Slab cert verification for seller P2P collectibles (PSA / GemRate / comps / AI pre-grade).
  CERT_VERIFY_PROVIDER: z.enum(["simulated", "psa", "gemrate"]).default("simulated"),
  PSA_API_TOKEN: z.string().optional(),
  GEMRATE_API_KEY: z.string().optional(),
  PRICECHARTING_API_KEY: z.string().optional(),
  CARDGRADE_API_KEY: z.string().optional(),

  // Seller P2P collectibles — in-app USDC escrow (buy → ship → confirm). Off by default;
  // Corp B money-transmission / marketplace-intermediary counsel required before prod.
  COLLECTIBLES_ESCROW_ENABLED: boolish,

  // Identity Vault — relationship graph prototype (Neo4j Aura prod swap). On by default in dev.
  IDENTITY_VAULT_ENABLED: boolishDefaultTrue,

  // Phase 20 — key-vault custody (closes invariant m / audit C-1). At-rest secrets
  // (per-user Hedera keys, the issuer JWK) are wrapped via keyVaultService. The
  // `local` AES-256-GCM provider is dev/test only — production must use a real KMS
  // (aws|gcp); see productionFatals.
  KMS_PROVIDER: z.enum(["local", "aws", "gcp"]).default("local"),
  KMS_MASTER_KEY: z.string().optional(), // base64, ≥32 bytes — only used by the local provider

  // Phase 20 — how a user's Hedera transaction is signed (custody level):
  //   keyvault — unwrap + sign in-process (encryption-at-rest; default)
  //   hsm      — sign via an HSM; the private key never enters the process
  //   ondevice — non-custodial: the server holds no key; signing is on the user's device
  HEDERA_SIGNER: z.enum(["keyvault", "hsm", "ondevice"]).default("keyvault"),

  // Phase 20 — data warehouse export (analytics pipeline prototype). Off by default;
  // incremental export of audit/ledger/MCP streams to a swappable sink.
  DATA_WAREHOUSE_ENABLED: boolish,
  WAREHOUSE_SINK: z.enum(["simulated", "bigquery", "snowflake", "redshift"]).default("simulated"),

  // Journey orchestration platform (prototype). Off by default; gates the /api/journeys
  // routes. Decision-only: runs produce a decision + Server-Driven-UI descriptors and do
  // not move money or grant tiers (the live onboarding stays authoritative until cutover).
  JOURNEYS_ENABLED: boolish,

  // Phase 15 — internal agent operations (back office). Master kill-switch (on by
  // default; agents only recommend/draft — a deterministic RBAC gate executes).
  // OPERATIONS_ORCHESTRATOR mirrors ONBOARDING_ORCHESTRATOR; the review floor below
  // which an auto-decision escalates to a human mirrors ONBOARDING_REVIEW_FLOOR.
  OPERATIONS_ENABLED: boolishDefaultTrue,
  OPERATIONS_ORCHESTRATOR: z.enum(["simulated", "anthropic"]).default("simulated"),
  OPERATIONS_REVIEW_FLOOR: z.coerce.number().min(0).max(1).default(0.3),

  // Phase 15.4 — optional Temporal durable-execution substrate for the operations
  // runner. Off by default → in-process engine. When on, the runner orchestrates
  // through Temporal; if the SDK/server is unavailable it degrades to in-process.
  TEMPORAL_ENABLED: boolish,
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("argus-operations"),

  // Phase 15.4 — Conductor OSS as the PRIMARY agent-workflow substrate (design §7:
  // Conductor for agents, Temporal for money). Takes precedence over Temporal for the
  // operations runner when enabled; degrades to in-process if the SDK/server is down.
  CONDUCTOR_ENABLED: boolish,
  CONDUCTOR_URL: z.string().default("http://localhost:8080/api"),

  // Phase 20 — Temporal for the MONEY path (design §7). When on, transfers run as a
  // durable, exactly-once Temporal workflow (the activity is the idempotency-keyed
  // ledger transfer); off by default → direct call. Degrades to direct if unavailable.
  TEMPORAL_MONEY_ENABLED: boolish,
  TEMPORAL_MONEY_TASK_QUEUE: z.string().default("argus-money"),

  METRICS_TOKEN: z.string().optional(),

  AUTH_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(30),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(100),
});

export type Config = z.infer<typeof schema> & {
  isProd: boolean;
  isTest: boolean;
  dbDialect: "postgres" | "sqlite";
};

/**
 * Production safety gates as a PURE function (no process.exit) so the invariants
 * can be tested. Returns the list of fatal misconfigurations; empty in non-prod.
 */
export function productionFatals(c: z.infer<typeof schema>): string[] {
  const fatal: string[] = [];
  if (c.NODE_ENV !== "production") return fatal;
  if (c.JWT_SECRET === KNOWN_DEV_JWT_SECRET) {
    fatal.push("JWT_SECRET is set to the known dev default; set a strong random secret in production.");
  }
  if (c.JWT_SECRET.length < 32) {
    fatal.push("JWT_SECRET must be at least 32 characters in production.");
  }
  if (c.ALLOW_PASSWORD_AUTH) {
    fatal.push("ALLOW_PASSWORD_AUTH must be false in production (passkeys only).");
  }
  if (c.HEDERA_ENABLED && (!c.HEDERA_OPERATOR_ID || !c.HEDERA_OPERATOR_KEY)) {
    fatal.push("HEDERA_ENABLED=true requires HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY.");
  }
  // The paymaster/operator key must not be raw plaintext in production — wrap it via
  // the key vault (gcm.v1.) so it is encrypted at rest like per-user keys.
  if (c.HEDERA_ENABLED && c.HEDERA_OPERATOR_KEY && !c.HEDERA_OPERATOR_KEY.startsWith("gcm.v1.")) {
    fatal.push("HEDERA_OPERATOR_KEY must be KMS-wrapped (gcm.v1.) in production, not raw plaintext.");
  }
  // Custody: the local AES stand-in is a server-held master key — encryption at
  // rest, not HSM/on-device custody. Production must wrap keys with a real KMS.
  if (c.KMS_PROVIDER === "local") {
    fatal.push("KMS_PROVIDER=local (AES stand-in) must not be used in production; use a real KMS (aws|gcp).");
  }
  if (c.TRADING_ENABLED) {
    fatal.push("TRADING_ENABLED must be false in production — the Phase-17 Stage-1 broker is simulated only.");
  }
  if (c.ARGUS_PAY_ENABLED) {
    fatal.push("ARGUS_PAY_ENABLED must be false in production — the Phase-21 Stage-1 rail is a prototype (money-transmission licensing pending).");
  }
  if (c.FX_ENABLED && c.FX_RATE_PROVIDER === "simulated") {
    fatal.push("FX_ENABLED with FX_RATE_PROVIDER=simulated must not run in production — wire a licensed FX rate provider (circle|oanda).");
  }
  if (c.FX_SETTLEMENT_ENABLED && c.FX_RATE_PROVIDER === "simulated") {
    fatal.push("FX_SETTLEMENT_ENABLED with FX_RATE_PROVIDER=simulated must not run in production — cross-currency settlement at a simulated rate is a prototype.");
  }
  if (c.TREASURY_ENABLED) {
    fatal.push("TREASURY_ENABLED must be false in production — the tokenized-treasury seam is a prototype (regulated issuer/transfer-agent/ATS + securities counsel pending).");
  }
  if (c.EQUITIES_ENABLED) {
    fatal.push("EQUITIES_ENABLED must be false in production — the Phase-18.6 tokenized-equities seam is a prototype (regulated issuer/transfer-agent/ATS + securities counsel pending).");
  }
  if (c.BANK_RAILS_ENABLED) {
    fatal.push("BANK_RAILS_ENABLED must be false in production — the Phase-19 Stage-1 bank rails are simulated (BaaS/partner-bank + FinCEN MSB + KYC/AML vendor pending).");
  }
  if (c.CARDS_ENABLED) {
    fatal.push("CARDS_ENABLED must be false in production — the Phase-19.4 cards seam is simulated (card processor + BIN sponsor + PCI scope pending).");
  }
  if (c.BILLPAY_ENABLED) {
    fatal.push("BILLPAY_ENABLED must be false in production — the Phase-19.3 bill-pay seam is simulated (partner bank + biller network pending).");
  }
  if (c.COLLECTIBLES_ESCROW_ENABLED) {
    fatal.push(
      "COLLECTIBLES_ESCROW_ENABLED must be false in production — in-app collectible escrow is a Corp B prototype (MSB/marketplace-intermediary counsel pending)."
    );
  }
  if (c.TEEN_ENABLED) {
    fatal.push("TEEN_ENABLED must be false in production — the Phase-22 Starter suite is simulated (BaaS/card issuer + COPPA/custodial counsel pending).");
  }
  if (c.TEEN_CREDIT_BUILDER_ENABLED) {
    fatal.push("TEEN_CREDIT_BUILDER_ENABLED must be false in production — the Phase-22.4 credit-builder seam is simulated (bureau-reporting partner + consumer-credit counsel pending).");
  }
  if (c.TEEN_CUSTODIAL_ENABLED) {
    fatal.push("TEEN_CUSTODIAL_ENABLED must be false in production — the Phase-22.5 custodial-investing seam is simulated (custodial broker-dealer + transfer agent + securities counsel pending).");
  }
  if (c.DATA_WAREHOUSE_ENABLED && c.WAREHOUSE_SINK === "simulated") {
    fatal.push("DATA_WAREHOUSE_ENABLED with WAREHOUSE_SINK=simulated must not run in production — wire a real warehouse (bigquery/snowflake/redshift).");
  }
  if (c.ONBOARDING_ORCHESTRATOR === "anthropic" && !c.ANTHROPIC_API_KEY) {
    fatal.push("ONBOARDING_ORCHESTRATOR=anthropic requires ANTHROPIC_API_KEY.");
  }
  if (c.SMARTCHAT_ORCHESTRATOR === "anthropic" && !c.ANTHROPIC_API_KEY) {
    fatal.push("SMARTCHAT_ORCHESTRATOR=anthropic requires ANTHROPIC_API_KEY.");
  }
  if (c.OPERATIONS_ORCHESTRATOR === "anthropic" && !c.ANTHROPIC_API_KEY) {
    fatal.push("OPERATIONS_ORCHESTRATOR=anthropic requires ANTHROPIC_API_KEY.");
  }
  if (!c.ADMIN_JWT_SECRET || c.ADMIN_JWT_SECRET === c.JWT_SECRET) {
    fatal.push("ADMIN_JWT_SECRET must be set and distinct from JWT_SECRET in production.");
  }
  // When the backend is actually wired to a fraud engine, the shared service key
  // must be strong (it also authenticates the engine's freeze callbacks). Enabled
  // without a URL is inert and allowed, so existing deploys are unaffected.
  if (c.FRAUD_REMOTE_ENABLED && c.FRAUD_ENGINE_URL) {
    if (!c.FRAUD_ENGINE_API_KEY || c.FRAUD_ENGINE_API_KEY === KNOWN_DEV_FRAUD_KEY) {
      fatal.push("FRAUD_ENGINE_URL is set but FRAUD_ENGINE_API_KEY is missing or the known dev default.");
    } else if (c.FRAUD_ENGINE_API_KEY.length < 32) {
      fatal.push("FRAUD_ENGINE_API_KEY must be at least 32 characters in production.");
    }
  }
  return fatal;
}

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("[config] Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const c = parsed.data;
  const isProd = c.NODE_ENV === "production";
  const isTest = c.NODE_ENV === "test";

  // Production safety gates — fail fast.
  const fatal = productionFatals(c);
  if (fatal.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[config] Refusing to start in production:");
    for (const f of fatal) {
      // eslint-disable-next-line no-console
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  return {
    ...c,
    isProd,
    isTest,
    dbDialect: c.DATABASE_URL ? "postgres" : "sqlite",
  };
}

export const config: Config = load();
