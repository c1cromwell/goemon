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

const TIER_OPS: Record<number, string[]> = {
  0: ["balance:read", "profile:read"],
  1: ["balance:read", "statement:read", "profile:read"],
  2: ["balance:read", "transfer:low", "statement:read", "profile:read"],
  3: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read"],
  4: ["balance:read", "transfer:low", "transfer:high", "statement:read", "profile:read", "lending:read"],
};

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

export async function completeSimulatedKyc(userId: string): Promise<IdentityProfile> {
  const db = getDb();
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (!profile.kyc_reference) throw new AppError(ErrorCode.VALIDATION, "No KYC in progress");
  if (profile.tier >= 2) throw new AppError(ErrorCode.CONFLICT, "KYC already completed");

  const now = new Date().toISOString();
  const allowedOps = TIER_OPS[2]!;

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE identity_profiles
       SET tier = 2, identity_status = 'kyc_passed', sanctions_clear = 1,
           risk_tier = 'low', completed_at = ?, updated_at = ?
       WHERE user_id = ?`,
      [now, now, userId]
    );
    await tx.execute(
      `UPDATE kyc_records
       SET status = 'passed', sanctions_result = 'clear', pep_result = 'clear',
           risk_tier = 'low', risk_score = 0.1
       WHERE provider_ref = ?`,
      [profile.kyc_reference]
    );
  });

  // Issue VC (has its own transaction)
  await issueCredential(userId, 2, allowedOps);
  await logAudit({ userId, action: "identity.kyc.complete", resource: userId, details: { tier: 2 } });
  return (await getProfile(userId))!;
}

export async function getKycStatus(
  userId: string
): Promise<{ status: string; tier: number; kyc_reference: string | null }> {
  const profile = await getProfile(userId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  return { status: profile.identity_status, tier: profile.tier, kyc_reference: profile.kyc_reference };
}
