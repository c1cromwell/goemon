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

const KNOWN_DEV_JWT_SECRET = "bankai_dev_secret_change_in_production";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  BASE_URL: z.string().url().default("http://localhost:3001"),
  CREDENTIAL_BASE_URL: z.string().url().default("http://localhost:3001"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  ANTHROPIC_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(1),

  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./data/bankai.db"),
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
  RP_NAME: z.string().default("BankAI"),
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

  HEDERA_ENABLED: boolish,
  HEDERA_NETWORK: z.enum(["testnet", "mainnet", "previewnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  HEDERA_USDC_TOKEN_ID: z.string().optional(),

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
  const fatal: string[] = [];
  if (isProd) {
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
    if (c.ONBOARDING_ORCHESTRATOR === "anthropic" && !c.ANTHROPIC_API_KEY) {
      fatal.push("ONBOARDING_ORCHESTRATOR=anthropic requires ANTHROPIC_API_KEY.");
    }
    if (c.SMARTCHAT_ORCHESTRATOR === "anthropic" && !c.ANTHROPIC_API_KEY) {
      fatal.push("SMARTCHAT_ORCHESTRATOR=anthropic requires ANTHROPIC_API_KEY.");
    }
    if (!c.ADMIN_JWT_SECRET || c.ADMIN_JWT_SECRET === c.JWT_SECRET) {
      fatal.push("ADMIN_JWT_SECRET must be set and distinct from JWT_SECRET in production.");
    }
  }
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
