/**
 * Fraud Engine configuration.
 *
 * Read config ONLY through this module. Production fails fast on insecure config
 * (mirrors the Goeman backend's posture) — the service-auth key must not be the
 * known dev default in production.
 */

import "dotenv/config";
import { z } from "zod";

const KNOWN_DEV_API_KEY = "fraud_dev_key_change_in_production";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const boolishDefaultTrue = z
  .string()
  .optional()
  .transform((v) => v !== "false" && v !== "0");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4500),

  FRAUD_ENGINE_API_KEY: z.string().min(1).default(KNOWN_DEV_API_KEY),

  GOEMAN_BASE_URL: z.string().url().default("http://localhost:3001"),
  GOEMAN_SERVICE_KEY: z.string().min(1).default(KNOWN_DEV_API_KEY),

  SQLITE_PATH: z.string().default("./data/fraud.db"),

  FRAUD_AUTO_REMEDIATE: boolishDefaultTrue,

  // CEL seam — the rule/policy evaluator. `subset` is the in-process CEL-compatible
  // subset (default); `celgo` is the spec-complete production swap (gRPC sidecar / WASM).
  RULE_EVALUATOR: z.enum(["subset", "celgo"]).default("subset"),
  // Decision policy source: `thresholds` (the routing_config ladder, default) or
  // `cel` (the action_policy CEL table). Opt-in; the ladder stays the safe default.
  ACTION_POLICY: z.enum(["thresholds", "cel"]).default("thresholds"),
});

const parsed = schema.parse(process.env);

const isProd = parsed.NODE_ENV === "production";

/** Reasons production config is unsafe. Pure so it is unit-testable. */
export function productionFatals(c: typeof parsed): string[] {
  const fatal: string[] = [];
  if (c.FRAUD_ENGINE_API_KEY === KNOWN_DEV_API_KEY) {
    fatal.push("FRAUD_ENGINE_API_KEY is the known dev default; set a strong random secret in production.");
  }
  if (c.FRAUD_ENGINE_API_KEY.length < 32) {
    fatal.push("FRAUD_ENGINE_API_KEY must be at least 32 characters in production.");
  }
  return fatal;
}

if (isProd) {
  const fatal = productionFatals(parsed);
  if (fatal.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[config] FATAL production misconfiguration:\n  - " + fatal.join("\n  - "));
    process.exit(1);
  }
}

export const config = {
  ...parsed,
  GOEMAN_BASE_URL:
    parsed.GOEMAN_BASE_URL ||
    (process.env.ARGUS_BASE_URL as string | undefined) ||
    "http://localhost:3001",
  GOEMAN_SERVICE_KEY:
    parsed.GOEMAN_SERVICE_KEY ||
    (process.env.ARGUS_SERVICE_KEY as string | undefined) ||
    KNOWN_DEV_API_KEY,
  isProd,
  KNOWN_DEV_API_KEY,
};

export type Config = typeof config;
