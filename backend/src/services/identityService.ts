/**
 * Phase 3 — Identity / tiered KYC service.
 *
 * Manages the tiered identity ladder:
 *   Tier 0 — passkey only (created on registration)
 *   Tier 1 — phone + email verified
 *   Tier 2 — KYC passed (issues a VC via vcService)
 *   Tier 3/4 — accredited / lending (future phases)
 *
 * In Phase 3, KYC is simulated. Phase 3.5+ will call a real IDV provider
 * (Persona/Onfido) and drive the tier upgrade from the webhook handler.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { issueCredential } from "./vcService";

export type AccountType = "standard" | "guardian" | "minor";

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
  account_type: AccountType;
  guardian_user_id: string | null;
  dob: string | null;
  is_minor: number;
  household_id: string | null;
}

const TIER_OPS: Record<number, string[]> = {
  0: ["balance:read", "profile:read"],
  1: ["balance:read", "statement:read", "profile:read"],
  2: ["balance:read", "transfer:low", "statement:read", "profile:read"],
  3: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read"],
  4: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read", "lending:read"],
};

/** Ops minors never receive regardless of tier (Phase 22 — guardian-gated money-out lands in 22.1). */
const MINOR_FORBIDDEN_OPS = new Set(["transfer:high", "lending:read"]);

export function isMinorProfile(profile: Pick<IdentityProfile, "account_type" | "is_minor">): boolean {
  return profile.account_type === "minor" || profile.is_minor === 1;
}

/** Single source of truth for tier-scoped ops; applies minor restrictions when applicable. */
export function getTierOpsForProfile(profile: Pick<IdentityProfile, "tier" | "account_type" | "is_minor">): string[] {
  const base = TIER_OPS[profile.tier] ?? TIER_OPS[0]!;
  if (!isMinorProfile(profile)) return [...base];
  return base.filter((op) => !MINOR_FORBIDDEN_OPS.has(op));
}

export function getTierOps(tier: number): string[] {
  return TIER_OPS[tier] ?? TIER_OPS[0]!;
}

export async function getProfile(userId: string): Promise<IdentityProfile | null> {
  return getDb().queryOne<IdentityProfile>(
    "SELECT * FROM identity_profiles WHERE user_id = ?",
    [userId]
  );
}

export async function ensureProfile(userId: string): Promise<IdentityProfile> {
  const existing = await getProfile(userId);
  if (existing) return existing;
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    "INSERT INTO identity_profiles (id, user_id, tier, identity_status, created_at, updated_at) VALUES (?, ?, 0, 'pending', ?, ?)",
    [id, userId, now, now]
  );
  return (await getProfile(userId))!;
}

export async function upgradeTier1(userId: string, phone: string): Promise<IdentityProfile> {
  const db = getDb();
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (profile.tier >= 1) throw new AppError(ErrorCode.CONFLICT, "Already at Tier 1 or above");

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE users SET phone = ?, updated_at = ? WHERE id = ?",
      [phone, now, userId]
    );
    await tx.execute(
      "UPDATE identity_profiles SET tier = 1, identity_status = 'tier1_verified', initiated_at = ?, updated_at = ? WHERE user_id = ?",
      [now, now, userId]
    );
  });

  await logAudit({ userId, action: "identity.tier1", resource: userId, details: { phone: phone.slice(-4) } });
  return (await getProfile(userId))!;
}

export async function initiateKyc(
  userId: string,
  fullName: string,
  dob: string,
  country = "US"
): Promise<{ kyc_reference: string }> {
  const db = getDb();
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (profile.tier < 1) throw new AppError(ErrorCode.TIER_REQUIRED, "Tier 1 required before KYC");
  if (profile.tier >= 2) throw new AppError(ErrorCode.CONFLICT, "KYC already completed");

  const kycId = uuidv4();
  const kycRef = `sim-${kycId.slice(0, 8)}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE identity_profiles SET kyc_reference = ?, initiated_at = ?, updated_at = ? WHERE user_id = ?",
      [kycRef, now, now, userId]
    );
    await tx.execute(
      `INSERT INTO kyc_records (id, user_id, profile_id, provider, provider_ref, status, checked_name, checked_dob, notes)
       VALUES (?, ?, ?, 'simulated', ?, 'pending', ?, ?, ?)`,
      [kycId, userId, profile.id, kycRef, fullName, dob, JSON.stringify({ country })]
    );
  });

  await logAudit({ userId, action: "identity.kyc.initiate", resource: kycId, details: { kyc_reference: kycRef } });
  return { kyc_reference: kycRef };
}

/**
 * Simulated sanctions / PEP screen. A real deployment swaps this for the
 * SANCTIONS_PROVIDER adapter (TRM, etc.). Returns whether the name is clear.
 */
const SANCTIONS_DENYLIST = new Set(["ofac test", "blocked person", "sanctioned entity"]);
export function screenSanctions(fullName: string): { clear: boolean } {
  return { clear: !SANCTIONS_DENYLIST.has(fullName.trim().toLowerCase()) };
}

export interface KycDecisionInput {
  tier: number;
  riskTier: string;
  sanctionsClear: boolean;
  /** Risk score in [0,1] (higher = worse), stored on the kyc_records row. */
  riskScore: number;
  /** Onboarding session that drove this grant (Phase 5A); null for the legacy path. */
  sessionId?: string | null;
  provider?: string;
}

/**
 * Shared tier-grant core (the single source of truth for KYC completion). Updates
 * identity_profiles + kyc_records and issues the Verifiable Credential. Used by the
 * legacy simulated KYC path and by the Phase 5A risk orchestrator. The actual
 * decision to call this is made by deterministic policy, never directly by the LLM.
 */
export async function completeKycDecision(userId: string, input: KycDecisionInput): Promise<IdentityProfile> {
  const db = getDb();
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (profile.tier >= 2) throw new AppError(ErrorCode.CONFLICT, "KYC already completed");

  const now = new Date().toISOString();
  const tier = input.tier;
  const allowedOps = getTierOpsForProfile({ tier, account_type: profile.account_type ?? "standard", is_minor: profile.is_minor ?? 0 });
  const status = tier >= 2 ? "kyc_passed" : "tier1_verified";
  const sanctionsResult = input.sanctionsClear ? "clear" : "blocked";

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE identity_profiles
       SET tier = ?, identity_status = ?, sanctions_clear = ?, risk_tier = ?,
           completed_at = ?, updated_at = ?, onboarding_session_id = COALESCE(?, onboarding_session_id)
       WHERE user_id = ?`,
      [tier, status, input.sanctionsClear ? 1 : 0, input.riskTier, now, now, input.sessionId ?? null, userId]
    );

    if (profile.kyc_reference) {
      await tx.execute(
        `UPDATE kyc_records
         SET status = 'passed', sanctions_result = ?, pep_result = ?, risk_tier = ?, risk_score = ?
         WHERE provider_ref = ?`,
        [sanctionsResult, sanctionsResult, input.riskTier, input.riskScore, profile.kyc_reference]
      );
    } else {
      const kycId = uuidv4();
      const ref = `${input.provider ?? "simulated"}-${kycId.slice(0, 8)}`;
      await tx.execute(
        `INSERT INTO kyc_records (id, user_id, profile_id, provider, provider_ref, status,
           sanctions_result, pep_result, risk_tier, risk_score, notes)
         VALUES (?, ?, ?, ?, ?, 'passed', ?, ?, ?, ?, ?)`,
        [
          kycId,
          userId,
          profile.id,
          input.provider ?? "simulated",
          ref,
          sanctionsResult,
          sanctionsResult,
          input.riskTier,
          input.riskScore,
          JSON.stringify({ sessionId: input.sessionId ?? null }),
        ]
      );
      await tx.execute("UPDATE identity_profiles SET kyc_reference = ? WHERE user_id = ?", [ref, userId]);
    }
  });

  // Issue VC (has its own transaction)
  await issueCredential(userId, tier, allowedOps);
  await logAudit({
    userId,
    action: "identity.kyc.complete",
    resource: userId,
    details: { tier, riskTier: input.riskTier, sessionId: input.sessionId ?? null },
  });
  return (await getProfile(userId))!;
}

export async function completeSimulatedKyc(userId: string): Promise<IdentityProfile> {
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (!profile.kyc_reference) throw new AppError(ErrorCode.VALIDATION, "No KYC in progress");
  return completeKycDecision(userId, { tier: 2, riskTier: "low", sanctionsClear: true, riskScore: 0.1 });
}

export async function getKycStatus(
  userId: string
): Promise<{ status: string; tier: number; kyc_reference: string | null }> {
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  return { status: profile.identity_status, tier: profile.tier, kyc_reference: profile.kyc_reference };
}
