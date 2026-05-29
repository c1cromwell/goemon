/**
 * Phase 5A — Onboarding signal assessment.
 *
 * Turns raw onboarding signals (email, client IP, device fingerprint, behavior
 * hints) into PII-FREE sub-scores + coarse categorical flags. This is the only
 * module that sees the raw values; everything downstream (orchestrator model,
 * persisted session, audit) receives the minimized SignalSummary, never the raw
 * email/IP/fingerprint. That is a deliberate extension of the "never log raw PII"
 * rule in CONVENTIONS.md.
 *
 * The scoring is deterministic and rule-based so it is fully testable offline and
 * so simulated demo identities (sim/profiles.ts) can hit a target risk profile by
 * crafting their raw inputs and flowing through this same real scorer.
 */

import { getDb } from "../db";
import type { SignalSummary } from "../utils/orchestratorModel";

/** Raw signals — contains PII. Never persisted or forwarded as-is. */
export interface RawSignals {
  email: string;
  ip: string;
  deviceFingerprint?: string;
  /** Behavior hint: the flow was completed implausibly fast (bot-like). */
  rapidCompletion?: boolean;
}

export interface SignalAssessment {
  summary: SignalSummary;
  /** Hash kept out of the summary; used for cross-user reuse detection + storage. */
  deviceFingerprint: string | null;
}

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "trashmail.com",
  "yopmail.com",
]);
const FREE_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
]);

function scoreEmail(email: string): { score: number; category: SignalSummary["email_category"] } {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return { score: 0.2, category: "unknown" };
  if (DISPOSABLE_DOMAINS.has(domain)) return { score: 0.15, category: "disposable" };
  if (FREE_DOMAINS.has(domain)) return { score: 0.7, category: "free" };
  return { score: 0.9, category: "corporate" };
}

function scoreIp(ip: string): { score: number; category: SignalSummary["ip_category"] } {
  // Deterministic mapping over the IETF documentation/test ranges so demos and tests
  // are reproducible. A real deployment swaps this for an IP-intelligence provider.
  if (ip.startsWith("203.0.113.")) return { score: 0.25, category: "datacenter" }; // TEST-NET-3
  if (ip.startsWith("198.51.100.")) return { score: 0.4, category: "vpn_or_proxy" }; // TEST-NET-2
  if (
    ip === "unknown" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip === "::1"
  ) {
    return { score: 0.85, category: "residential" }; // local/dev
  }
  return { score: 0.8, category: "residential" };
}

/** Has this device fingerprint been seen on a DIFFERENT user's onboarding session? */
async function isDeviceReused(fingerprint: string, userId: string): Promise<boolean> {
  const row = await getDb().queryOne<{ n: number }>(
    "SELECT COUNT(DISTINCT user_id) AS n FROM onboarding_sessions WHERE device_fingerprint = ? AND user_id <> ?",
    [fingerprint, userId]
  );
  return (row?.n ?? 0) > 0;
}

export async function assessSignals(userId: string, raw: RawSignals): Promise<SignalAssessment> {
  const email = scoreEmail(raw.email);
  const ip = scoreIp(raw.ip);

  const fingerprint = raw.deviceFingerprint?.trim() || null;
  let deviceScore: number;
  let deviceReuse = false;
  if (!fingerprint) {
    deviceScore = 0.5; // unknown device — neither trusted nor flagged
  } else {
    deviceReuse = await isDeviceReused(fingerprint, userId);
    deviceScore = deviceReuse ? 0.25 : 0.85;
  }

  const rapid = raw.rapidCompletion === true;
  const behaviorScore = rapid ? 0.35 : 0.85;

  const summary: SignalSummary = {
    email_score: email.score,
    ip_score: ip.score,
    device_score: deviceScore,
    behavior_score: behaviorScore,
    email_category: email.category,
    ip_category: ip.category,
    device_reuse: deviceReuse,
    rapid_completion: rapid,
  };

  return { summary, deviceFingerprint: fingerprint };
}
