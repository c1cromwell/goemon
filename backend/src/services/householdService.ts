/**
 * Phase 22.0 — Goemon Starter household service.
 *
 * Household = one guardian (Tier-2 KYC, legal owner) + 1..N teens (minors, DOB-verified).
 * Guardian attests the teen's DOB; the teen has no independent KYC. All gated by TEEN_ENABLED
 * (prod-fatal until partners + counsel land).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getProfile, getTierOpsForProfile, type IdentityProfile } from "./identityService";
import { getUserByEmail, getUserById } from "./authService";
import { getUserBalances } from "./ledgerService";
import { starterHouseholdTotal } from "../observability/metrics";

export interface HouseholdRow {
  id: string;
  guardian_user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Household {
  id: string;
  guardianUserId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeenSummary {
  userId: string;
  email: string;
  fullName: string | null;
  dob: string;
  tier: number;
  identityStatus: string;
  balances: { cash: string; savings: string; currency: string };
  allowedOps: string[];
}

export interface GuardianDashboard {
  household: Household;
  teens: TeenSummary[];
  pendingApprovals: number;
  coachInsights: Array<{ id: string; teenUserId: string; insightType: string; summary: string; createdAt: string }>;
}

function assertTeenEnabled(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Goemon Starter is currently unavailable");
}

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    guardianUserId: row.guardian_user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Age in whole years on today's calendar date. */
export function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) throw new AppError(ErrorCode.VALIDATION, "dob must be a valid ISO date");
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

/** COPPA band: 13–17 inclusive (under-13 is out of scope). */
export function assertTeenAge(dob: string): void {
  const age = ageFromDob(dob);
  if (age < 13) throw new AppError(ErrorCode.VALIDATION, "Teen must be at least 13 years old");
  if (age >= 18) throw new AppError(ErrorCode.VALIDATION, "Teen must be under 18 (minor account)");
}

async function assertGuardianTier2(guardianUserId: string): Promise<IdentityProfile> {
  const profile = await getProfile(guardianUserId);
  if (!profile) throw new AppError(ErrorCode.NOT_FOUND, "Identity profile not found");
  if (profile.tier < 2) throw new AppError(ErrorCode.TIER_REQUIRED, "Tier 2 KYC required to manage a household");
  return profile;
}

export async function getHouseholdByGuardian(guardianUserId: string): Promise<Household | null> {
  const row = await getDb().queryOne<HouseholdRow>(
    "SELECT * FROM households WHERE guardian_user_id = ?",
    [guardianUserId]
  );
  return row ? toHousehold(row) : null;
}

export async function getHouseholdById(householdId: string): Promise<Household | null> {
  const row = await getDb().queryOne<HouseholdRow>("SELECT * FROM households WHERE id = ?", [householdId]);
  return row ? toHousehold(row) : null;
}

/** Create a household for the authenticated guardian (idempotent if one already exists). */
export async function createHousehold(guardianUserId: string, name = "My Household"): Promise<Household> {
  assertTeenEnabled();
  await assertGuardianTier2(guardianUserId);

  const existing = await getHouseholdByGuardian(guardianUserId);
  if (existing) return existing;

  const id = uuidv4();
  const now = new Date().toISOString();
  const trimmed = name.trim() || "My Household";

  await getDb().transaction(async (tx) => {
    await tx.execute(
      "INSERT INTO households (id, guardian_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, guardianUserId, trimmed, now, now]
    );
    await tx.execute(
      `UPDATE identity_profiles
       SET account_type = 'guardian', household_id = ?, updated_at = ?
       WHERE user_id = ?`,
      [id, now, guardianUserId]
    );
  });

  starterHouseholdTotal.inc({ action: "created" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.household.create",
    resource: id,
    details: { householdId: id, guardianUserId, name: trimmed },
  });

  return (await getHouseholdByGuardian(guardianUserId))!;
}

async function listTeenProfiles(householdId: string): Promise<IdentityProfile[]> {
  return getDb().query<IdentityProfile>(
    `SELECT * FROM identity_profiles
     WHERE household_id = ? AND account_type = 'minor'
     ORDER BY created_at ASC`,
    [householdId]
  );
}

/** Guardian attests DOB and creates a minor sub-profile (no independent KYC). */
export async function addTeen(input: {
  guardianUserId: string;
  email: string;
  fullName: string;
  dob: string;
}): Promise<TeenSummary> {
  assertTeenEnabled();
  await assertGuardianTier2(input.guardianUserId);
  assertTeenAge(input.dob);

  const household = await getHouseholdByGuardian(input.guardianUserId);
  if (!household) throw new AppError(ErrorCode.NOT_FOUND, "Create a household first");

  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new AppError(ErrorCode.VALIDATION, "email required");
  if (await getUserByEmail(email)) throw new AppError(ErrorCode.CONFLICT, "Email already registered");

  const fullName = input.fullName.trim();
  if (!fullName) throw new AppError(ErrorCode.VALIDATION, "fullName required");

  const teenUserId = uuidv4();
  const profileId = uuidv4();
  const accountId = uuidv4();
  const now = new Date().toISOString();

  await getDb().transaction(async (tx) => {
    await tx.execute(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, NULL, ?)",
      [teenUserId, email, fullName]
    );
    await tx.execute(
      "INSERT INTO accounts (id, user_id, account_number, balance_minor, currency) VALUES (?, ?, ?, ?, ?)",
      [accountId, teenUserId, accountId.slice(0, 8).toUpperCase(), 0n, "USD"]
    );
    await tx.execute(
      `INSERT INTO identity_profiles
         (id, user_id, tier, identity_status, account_type, guardian_user_id, dob, is_minor, household_id, created_at, updated_at)
       VALUES (?, ?, 0, 'minor_attested', 'minor', ?, ?, 1, ?, ?, ?)`,
      [profileId, teenUserId, input.guardianUserId, input.dob, household.id, now, now]
    );
  });

  const { getOrCreateSavingsSettings } = await import("./savingsGoalService");
  await getOrCreateSavingsSettings(teenUserId, input.guardianUserId);

  starterHouseholdTotal.inc({ action: "teen_added" });
  await logAudit({
    userId: input.guardianUserId,
    action: "starter.teen.add",
    resource: teenUserId,
    details: { guardianUserId: input.guardianUserId, teenUserId, householdId: household.id, dob: input.dob },
  });

  return (await buildTeenSummary(teenUserId))!;
}

async function buildTeenSummary(teenUserId: string): Promise<TeenSummary | null> {
  const user = await getUserById(teenUserId);
  const profile = await getProfile(teenUserId);
  if (!user || !profile) return null;

  const balances = await getUserBalances(teenUserId);
  return {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    dob: profile.dob ?? "",
    tier: profile.tier,
    identityStatus: profile.identity_status,
    balances: {
      cash: balances.cash.toString(),
      savings: balances.savings.toString(),
      currency: "USD",
    },
    allowedOps: getTierOpsForProfile(profile),
  };
}

export async function listTeens(guardianUserId: string): Promise<TeenSummary[]> {
  assertTeenEnabled();
  const household = await getHouseholdByGuardian(guardianUserId);
  if (!household) return [];

  const profiles = await listTeenProfiles(household.id);
  const teens: TeenSummary[] = [];
  for (const p of profiles) {
    const summary = await buildTeenSummary(p.user_id);
    if (summary) teens.push(summary);
  }
  return teens;
}

/** Guardian dashboard — per-teen balances, approval queue count, coach insights. */
export async function getGuardianDashboard(guardianUserId: string): Promise<GuardianDashboard> {
  assertTeenEnabled();
  const household = await getHouseholdByGuardian(guardianUserId);
  if (!household) throw new AppError(ErrorCode.NOT_FOUND, "Household not found — create one first");

  const { listGuardianReviews } = await import("./teenSpendService");
  const { listCoachInsightsForGuardian } = await import("./teenCoachService");
  const reviews = await listGuardianReviews(guardianUserId);
  const insights = await listCoachInsightsForGuardian(guardianUserId);

  return {
    household,
    teens: await listTeens(guardianUserId),
    pendingApprovals: reviews.length,
    coachInsights: insights.slice(0, 10).map((i) => ({
      id: i.id,
      teenUserId: i.teen_user_id,
      insightType: i.insight_type,
      summary: i.summary,
      createdAt: i.created_at,
    })),
  };
}

/** Resolve the household for a teen user (null if not a minor). */
export async function getHouseholdForUser(userId: string): Promise<Household | null> {
  const profile = await getProfile(userId);
  if (!profile?.household_id) return null;
  return getHouseholdById(profile.household_id);
}

/** Assert the caller is the guardian of the given teen. */
export async function assertGuardianOfTeen(guardianUserId: string, teenUserId: string): Promise<void> {
  const teenProfile = await getProfile(teenUserId);
  if (!teenProfile || teenProfile.account_type !== "minor") {
    throw new AppError(ErrorCode.NOT_FOUND, "Teen not found");
  }
  if (teenProfile.guardian_user_id !== guardianUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Not the guardian of this teen");
  }
}
