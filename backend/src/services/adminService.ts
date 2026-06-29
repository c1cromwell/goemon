/**
 * Phase 5A — Admin service.
 *
 * Backs the admin console: seed/login, read-only visibility into ALL registered
 * identities (the "preserved & visible" requirement), the manual-review queue, the
 * human review decision, and generation of simulated demo identities.
 *
 * All admin actions are audited. Money never appears here; onboarding scores are
 * REAL confidence/risk values in [0,1].
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { hashPassword, verifyPassword, createUser } from "./authService";
import { completeKycDecision } from "./identityService";
import {
  startOnboarding,
  submitDocument,
  submitPossession,
  getStatus,
  listUserSessionViews,
  type SessionView,
} from "./riskOrchestratorService";
import { SIM_PROFILES, DEFAULT_SIM_PROFILES } from "../sim/profiles";
import type { AdminRole } from "../middleware/rbac";

const SEED_ADMIN_EMAIL = "admin@goemanglobal.com";
const SEED_ADMIN_PASSWORD = "Admin1234!";
const SEED_CEO_EMAIL = "ceo@goemanglobal.com";
const SEED_CEO_PASSWORD = "Ceo1234!";
const SEED_CS_EMAIL = "cos@goemanglobal.com";
const SEED_CS_PASSWORD = "Cos1234!";

/** Dev-only manifest — printed by `npm run setup` and returned from POST /admin/seed. */
export const DEV_ADMIN_ACCOUNTS: ReadonlyArray<{ email: string; password: string; role: AdminRole }> = [
  { email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD, role: "admin" },
  { email: SEED_CEO_EMAIL, password: SEED_CEO_PASSWORD, role: "ceo" },
  { email: SEED_CS_EMAIL, password: SEED_CS_PASSWORD, role: "chief_of_staff" },
];

export function printAdminAccountManifest(): void {
  console.log("\n== Admin / CEO approver accounts (dev) ==");
  for (const a of DEV_ADMIN_ACCOUNTS) {
    console.log(`  ${a.role.padEnd(16)} ${a.email} / ${a.password}`);
  }
  console.log("  Login: http://localhost:5173/admin/login\n");
}

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: AdminRole;
}

/** Idempotently create the default admin (dev/seed convenience). */
export async function seedAdmin(): Promise<{ created: boolean; email: string }> {
  const db = getDb();
  const existing = await db.queryOne<AdminRow>("SELECT * FROM admins WHERE email = ?", [SEED_ADMIN_EMAIL]);
  if (existing) return { created: false, email: SEED_ADMIN_EMAIL };
  const hash = await hashPassword(SEED_ADMIN_PASSWORD);
  await db.execute("INSERT INTO admins (id, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [
    uuidv4(),
    SEED_ADMIN_EMAIL,
    hash,
  ]);
  await logAudit({ action: "admin.seed", resource: SEED_ADMIN_EMAIL });
  return { created: true, email: SEED_ADMIN_EMAIL };
}

async function seedRoleAccount(email: string, password: string, role: AdminRole): Promise<{ created: boolean; email: string }> {
  const db = getDb();
  const existing = await db.queryOne<AdminRow>("SELECT * FROM admins WHERE email = ?", [email]);
  if (existing) return { created: false, email };
  const hash = await hashPassword(password);
  await db.execute("INSERT INTO admins (id, email, password_hash, role) VALUES (?, ?, ?, ?)", [
    uuidv4(),
    email,
    hash,
    role,
  ]);
  await logAudit({ action: "admin.seed", resource: email, details: { role } });
  return { created: true, email };
}

/** M2 — idempotent CEO + Chief of Staff approver accounts. */
export async function seedCeoApprovers(): Promise<{ ceo: { created: boolean; email: string }; cs: { created: boolean; email: string } }> {
  const ceo = await seedRoleAccount(SEED_CEO_EMAIL, SEED_CEO_PASSWORD, "ceo");
  const cs = await seedRoleAccount(SEED_CS_EMAIL, SEED_CS_PASSWORD, "chief_of_staff");
  return { ceo, cs };
}

/** Seed admin + CEO + CS (idempotent). Used by setup and POST /admin/seed. */
export async function seedAllAdminAccounts(): Promise<{
  admin: { created: boolean; email: string };
  ceo: { created: boolean; email: string };
  cs: { created: boolean; email: string };
  accounts: typeof DEV_ADMIN_ACCOUNTS;
}> {
  const admin = await seedAdmin();
  const { ceo, cs } = await seedCeoApprovers();
  return { admin, ceo, cs, accounts: DEV_ADMIN_ACCOUNTS };
}

export async function authenticateAdmin(email: string, password: string): Promise<{ adminId: string; role: AdminRole }> {
  const admin = await getDb().queryOne<AdminRow>("SELECT * FROM admins WHERE email = ?", [email.toLowerCase()]);
  if (!admin || !admin.password_hash || !(await verifyPassword(password, admin.password_hash))) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid admin credentials");
  }
  // Defense in depth: if an ADMIN_EMAILS allow-list is configured, enforce it.
  if (config.ADMIN_EMAILS.length > 0 && !config.ADMIN_EMAILS.includes(admin.email.toLowerCase())) {
    throw new AppError(ErrorCode.FORBIDDEN, "Email not in admin allow-list");
  }
  await logAudit({ action: "admin.login", resource: admin.id });
  return { adminId: admin.id, role: admin.role };
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

/** List EVERY registered identity with its tier/risk and latest onboarding outcome. */
export async function listIdentities(): Promise<IdentitySummary[]> {
  const rows = await getDb().query<{
    user_id: string;
    email: string;
    full_name: string | null;
    is_simulated: number;
    tier: number;
    identity_status: string;
    risk_tier: string;
    session_status: string | null;
    decision: string | null;
    pii_confidence: number | null;
    created_at: string;
  }>(
    `SELECT u.id AS user_id, u.email, u.full_name, u.is_simulated,
            ip.tier, ip.identity_status, ip.risk_tier,
            s.status AS session_status, s.decision, s.pii_confidence,
            u.created_at
     FROM users u
     JOIN identity_profiles ip ON ip.user_id = u.id
     LEFT JOIN onboarding_sessions s ON s.id = (
       SELECT id FROM onboarding_sessions WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
     )
     ORDER BY u.created_at DESC`
  );
  return rows.map((r) => ({ ...r, is_simulated: r.is_simulated === 1 }));
}

export async function getIdentityDetail(userId: string): Promise<{
  user: { id: string; email: string; full_name: string | null; is_simulated: boolean; created_at: string };
  profile: Record<string, unknown> | null;
  sessions: SessionView[];
  kyc_records: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
}> {
  const db = getDb();
  const user = await db.queryOne<{
    id: string;
    email: string;
    full_name: string | null;
    is_simulated: number;
    created_at: string;
  }>("SELECT id, email, full_name, is_simulated, created_at FROM users WHERE id = ?", [userId]);
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found");

  const profile = await db.queryOne<Record<string, unknown>>(
    "SELECT * FROM identity_profiles WHERE user_id = ?",
    [userId]
  );
  const kyc = await db.query<Record<string, unknown>>(
    "SELECT id, provider, status, sanctions_result, pep_result, risk_tier, risk_score, created_at FROM kyc_records WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const docs = await db.query<Record<string, unknown>>(
    "SELECT id, document_type, issuing_country, status, confidence_score, created_at FROM document_verifications WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const audit = await db.query<Record<string, unknown>>(
    "SELECT action, resource, status, details, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [userId]
  );
  const sessions = await listUserSessionViews(userId);

  return {
    user: { ...user, is_simulated: user.is_simulated === 1 },
    profile,
    sessions,
    kyc_records: kyc,
    documents: docs,
    audit,
  };
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

export async function listReviewQueue(status = "review_required"): Promise<ReviewItem[]> {
  return getDb().query<ReviewItem>(
    `SELECT s.id AS session_id, s.user_id, u.email, u.full_name, s.pii_confidence, s.decision, s.created_at
     FROM onboarding_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.status = ? ORDER BY s.created_at ASC`,
    [status]
  );
}

/** Human review decision on a session in review_required (compliance/admin only). */
export async function decideReview(
  adminId: string,
  sessionId: string,
  approve: boolean,
  note?: string
): Promise<SessionView> {
  const db = getDb();
  const session = await db.queryOne<{ id: string; user_id: string; status: string; pii_confidence: number | null; decided_risk_tier: string | null }>(
    "SELECT id, user_id, status, pii_confidence, decided_risk_tier FROM onboarding_sessions WHERE id = ?",
    [sessionId]
  );
  if (!session) throw new AppError(ErrorCode.NOT_FOUND, "Session not found");
  if (session.status !== "review_required") {
    throw new AppError(ErrorCode.CONFLICT, "Session is not awaiting review");
  }

  const now = new Date().toISOString();
  if (approve) {
    await completeKycDecision(session.user_id, {
      tier: 2,
      riskTier: session.decided_risk_tier ?? "medium",
      sanctionsClear: true,
      riskScore: Number((1 - (session.pii_confidence ?? 0)).toFixed(4)),
      sessionId: session.id,
      provider: "agentic",
    });
  }
  await db.execute(
    `UPDATE onboarding_sessions
     SET status = ?, decision = ?, reviewed_by = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [approve ? "approved" : "rejected", approve ? "auto_approve" : "reject", adminId, now, now, sessionId]
  );

  await logAudit({
    userId: session.user_id,
    action: "admin.onboarding.review",
    resource: sessionId,
    status: approve ? "success" : "blocked",
    details: { adminId, approve, note: note ?? null },
  });

  const sessions = await listUserSessionViews(session.user_id);
  return sessions.find((s) => s.id === sessionId)!;
}

export interface SimResult {
  profile: string;
  user_id: string;
  email: string;
  decision: string | null;
  status: string;
  expected: string;
}

/**
 * Create simulated demo identities (flagged is_simulated=1) and run each through the
 * real orchestrator + sub-agents so it lands on a genuine decision. Existing real and
 * seed users are never touched.
 */
export async function createSimulatedIdentities(profileKeys: string[] = DEFAULT_SIM_PROFILES): Promise<SimResult[]> {
  const db = getDb();
  const results: SimResult[] = [];

  for (const key of profileKeys) {
    const profile = SIM_PROFILES[key];
    if (!profile) throw new AppError(ErrorCode.VALIDATION, `Unknown sim profile: ${key}`);

    const short = uuidv4().slice(0, 8);
    const email = `sim-${profile.key}-${short}@${profile.emailDomain}`;
    const user = await createUser(email, profile.fullName);
    await db.execute("UPDATE users SET is_simulated = 1 WHERE id = ?", [user.id]);

    const fingerprint = `sim-fp-${short}`;
    let view = await startOnboarding(user.id, {
      email,
      ip: profile.ip,
      deviceFingerprint: fingerprint,
      rapidCompletion: profile.rapidCompletion,
    });

    if (view.required_steps.includes("document_validation") && profile.document) {
      view = await submitDocument(user.id, profile.document);
    }
    if (view.required_steps.includes("possession_check") && profile.possession) {
      view = await submitPossession(user.id, profile.possession);
    }

    const final = (await getStatus(user.id)) ?? view;
    results.push({
      profile: profile.key,
      user_id: user.id,
      email,
      decision: final.decision,
      status: final.status,
      expected: profile.expectedDecision,
    });
  }

  await logAudit({ action: "admin.simulation.create", details: { count: results.length, profiles: profileKeys } });
  return results;
}
