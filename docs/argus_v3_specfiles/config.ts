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

const KNOWN_DEV_JWT_SECRET = "goeman_dev_secret_change_in_production";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  BASE_URL: z.string().url().default("http://localhost:3001"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  ANTHROPIC_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(1),

  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().default("./data/goeman.db"),
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
  RP_NAME: z.string().default("Goeman Global Finance"),
  RP_ORIGIN: z.string().default("http://localhost:5173"),

  IDV_PROVIDER: z.enum(["simulated", "persona"]).default("simulated"),
  SANCTIONS_PROVIDER: z.enum(["simulated", "trm"]).default("simulated"),
  PERSONA_API_KEY: z.string().optional(),
  TRM_API_KEY: z.string().optional(),

  HEDERA_ENABLED: boolish,
  HEDERA_NETWORK: z.enum(["testnet", "mainnet", "previewnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  HEDERA_USDC_TOKEN_ID: z.string().optional(),

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
