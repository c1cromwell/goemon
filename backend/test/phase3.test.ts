/**
 * Phase 3 — Auth, identity ladder, and internal agent tests.
 *
 * Uses password auth (ALLOW_PASSWORD_AUTH=true from vitest.config.ts) since a
 * real WebAuthn ceremony requires a browser. WebAuthn option generation is
 * tested by calling the service function directly and checking structure.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-phase3-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
}

// ---------------------------------------------------------------------------
// User creation & password auth
// ---------------------------------------------------------------------------

describe("Phase 3: User creation and password auth", () => {
  const email = "auth3@test.com";
  const password = "test-password-123";
  let userId: string;

  beforeAll(setup);

  it("createUser inserts user, account, and identity_profile", async () => {
    const { createUser } = await import("../src/services/authService");
    const { hashPassword } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");

    const hash = await hashPassword(password);
    const user = await createUser(email, "Auth Tester", hash);
    userId = user.id;

    expect(user.id).toBeTruthy();
    expect(user.email).toBe(email);

    const account = await getDb().queryOne<{ id: string }>(
      "SELECT id FROM accounts WHERE user_id = ?",
      [userId]
    );
    expect(account).toBeTruthy();

    const profile = await getDb().queryOne<{ tier: number }>(
      "SELECT tier FROM identity_profiles WHERE user_id = ?",
      [userId]
    );
    expect(profile?.tier).toBe(0);
  });

  it("getUserByEmail returns the created user", async () => {
    const { getUserByEmail } = await import("../src/services/authService");
    const user = await getUserByEmail(email);
    expect(user?.id).toBe(userId);
    expect(user?.email).toBe(email);
  });

  it("verifyPassword succeeds with correct password and fails with wrong", async () => {
    const { getUserByEmail, verifyPassword } = await import("../src/services/authService");
    const user = await getUserByEmail(email);
    expect(await verifyPassword(password, user!.password_hash!)).toBe(true);
    expect(await verifyPassword("wrong", user!.password_hash!)).toBe(false);
  });

  it("getUserById returns the correct user", async () => {
    const { getUserById } = await import("../src/services/authService");
    const user = await getUserById(userId);
    expect(user?.email).toBe(email);
  });

  it("createUser rejects duplicate email", async () => {
    const { createUser, hashPassword } = await import("../src/services/authService");
    const hash = await hashPassword("x");
    await expect(createUser(email, "Dup", hash)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebAuthn options generation (service-level, no browser)
// ---------------------------------------------------------------------------

describe("Phase 3: WebAuthn registration options", () => {
  const webauthnEmail = "webauthn3@test.com";
  let webAuthnUserId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(webauthnEmail, "WebAuthn Tester");
    webAuthnUserId = user.id;
  });

  it("generatePasskeyRegistrationOptions returns a challenge and stores it", async () => {
    const { generatePasskeyRegistrationOptions } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");

    const options = await generatePasskeyRegistrationOptions(webAuthnUserId, webauthnEmail, "WebAuthn Tester");

    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe("localhost");
    expect(options.user.name).toBe(webauthnEmail);

    const stored = await getDb().queryOne<{ challenge: string }>(
      "SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND purpose = 'registration'",
      [webAuthnUserId]
    );
    expect(stored?.challenge).toBe(options.challenge);
  });

  it("generatePasskeyAuthenticationOptions returns a challenge for known user", async () => {
    const { generatePasskeyAuthenticationOptions } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");

    const { options, challengeId } = await generatePasskeyAuthenticationOptions(webauthnEmail);

    expect(options.challenge).toBeTruthy();
    expect(challengeId).toBeTruthy();

    const stored = await getDb().queryOne<{ challenge: string }>(
      "SELECT challenge FROM webauthn_challenges WHERE id = ?",
      [challengeId]
    );
    expect(stored?.challenge).toBe(options.challenge);
  });

  it("generatePasskeyAuthenticationOptions works for unknown email (usernameless)", async () => {
    const { generatePasskeyAuthenticationOptions } = await import("../src/services/authService");
    const { options } = await generatePasskeyAuthenticationOptions("ghost@nobody.com");
    expect(options.challenge).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Identity ladder
// ---------------------------------------------------------------------------

describe("Phase 3: Identity ladder", () => {
  const idEmail = "identity3@test.com";
  let idUserId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(idEmail, "Identity Tester");
    idUserId = user.id;
  });

  it("getProfile returns Tier 0 profile after user creation", async () => {
    const { getProfile } = await import("../src/services/identityService");
    const profile = await getProfile(idUserId);
    expect(profile?.tier).toBe(0);
    expect(profile?.identity_status).toBe("pending");
  });

  it("ensureProfile is idempotent", async () => {
    const { ensureProfile, getProfile } = await import("../src/services/identityService");
    const { getDb } = await import("../src/db");

    await ensureProfile(idUserId);
    const rows = await getDb().query("SELECT id FROM identity_profiles WHERE user_id = ?", [idUserId]);
    expect(rows.length).toBe(1); // no duplicate profile

    const p = await getProfile(idUserId);
    expect(p?.tier).toBe(0);
  });

  it("upgradeTier1 sets tier to 1 and stores phone", async () => {
    const { upgradeTier1, getProfile } = await import("../src/services/identityService");
    const { getDb } = await import("../src/db");

    const profile = await upgradeTier1(idUserId, "+15551234567");
    expect(profile.tier).toBe(1);
    expect(profile.identity_status).toBe("tier1_verified");

    const user = await getDb().queryOne<{ phone: string }>(
      "SELECT phone FROM users WHERE id = ?",
      [idUserId]
    );
    expect(user?.phone).toBe("+15551234567");
  });

  it("upgradeTier1 rejects if already Tier 1", async () => {
    const { upgradeTier1 } = await import("../src/services/identityService");
    const { AppError } = await import("../src/errors");
    await expect(upgradeTier1(idUserId, "+15551111111")).rejects.toBeInstanceOf(AppError);
  });

  it("initiateKyc creates a kyc_reference and kyc_record", async () => {
    const { initiateKyc, getProfile } = await import("../src/services/identityService");
    const { getDb } = await import("../src/db");

    const { kyc_reference } = await initiateKyc(idUserId, "Identity Tester", "1990-01-01", "US");
    expect(kyc_reference).toMatch(/^sim-/);

    const profile = await getProfile(idUserId);
    expect(profile?.kyc_reference).toBe(kyc_reference);

    const kycRow = await getDb().queryOne<{ status: string }>(
      "SELECT status FROM kyc_records WHERE provider_ref = ?",
      [kyc_reference]
    );
    expect(kycRow?.status).toBe("pending");
  });

  it("initiateKyc rejects if Tier 0", async () => {
    const { createUser } = await import("../src/services/authService");
    const { initiateKyc } = await import("../src/services/identityService");
    const { AppError } = await import("../src/errors");

    const tier0User = await createUser(`tier0-kyc@test.com`, "Tier0 User");
    await expect(initiateKyc(tier0User.id, "X", "2000-01-01")).rejects.toBeInstanceOf(AppError);
  });

  it("completeSimulatedKyc upgrades to Tier 2 and issues a VC", async () => {
    const { completeSimulatedKyc, getProfile } = await import("../src/services/identityService");
    const { getCredential } = await import("../src/services/vcService");

    const profile = await completeSimulatedKyc(idUserId);
    expect(profile.tier).toBe(2);
    expect(profile.identity_status).toBe("kyc_passed");
    expect(profile.sanctions_clear).toBe(1);

    const cred = await getCredential(idUserId);
    expect(cred?.revoked).toBe(0);
    expect(cred?.vc_jwt).toBeTruthy();
  });

  it("getKycStatus reflects current tier and status", async () => {
    const { getKycStatus } = await import("../src/services/identityService");
    const status = await getKycStatus(idUserId);
    expect(status.tier).toBe(2);
    expect(status.status).toBe("kyc_passed");
    expect(status.kyc_reference).toMatch(/^sim-/);
  });
});

// ---------------------------------------------------------------------------
// Internal agents
// ---------------------------------------------------------------------------

describe("Phase 3: Internal agents", () => {
  const agentEmail = "agent3@test.com";
  let agentUserId: string;
  let agentId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(agentEmail, "Agent Tester");
    agentUserId = user.id;
  });

  it("createAgent inserts an agent row", async () => {
    const { createAgent } = await import("../src/services/agentService");
    const agent = await createAgent(agentUserId, {
      name: "Test Bot",
      description: "A test agent",
      permissions: ["balance:read"],
      transfer_limit_minor: 10000,
    });
    agentId = agent.id;

    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("Test Bot");
    expect(agent.status).toBe("active");
    expect(JSON.parse(agent.permissions)).toContain("balance:read");
    expect(agent.transfer_limit_minor).toBe(10000);
  });

  it("listAgents returns active agents for the user", async () => {
    const { listAgents } = await import("../src/services/agentService");
    const agents = await listAgents(agentUserId);
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents.some((a) => a.id === agentId)).toBe(true);
  });

  it("getAgent returns the agent by id with ownership check", async () => {
    const { getAgent } = await import("../src/services/agentService");
    const agent = await getAgent(agentUserId, agentId);
    expect(agent?.name).toBe("Test Bot");
  });

  it("getAgent returns null for wrong owner", async () => {
    const { getAgent } = await import("../src/services/agentService");
    const result = await getAgent("other-user-id", agentId);
    expect(result).toBeNull();
  });

  it("updateAgent patches name and permissions (within Tier 0 allowed ops)", async () => {
    const { updateAgent, getAgent } = await import("../src/services/agentService");
    const updated = await updateAgent(agentUserId, agentId, {
      name: "Renamed Bot",
      permissions: ["balance:read", "profile:read"],
    });
    expect(updated.name).toBe("Renamed Bot");
    expect(JSON.parse(updated.permissions)).toContain("profile:read");

    const fetched = await getAgent(agentUserId, agentId);
    expect(fetched?.name).toBe("Renamed Bot");
  });

  it("updateAgent rejects permissions that exceed user tier", async () => {
    const { updateAgent } = await import("../src/services/agentService");
    const { AppError } = await import("../src/errors");
    // agentUserId is Tier 0 — statement:read is Tier 1
    await expect(
      updateAgent(agentUserId, agentId, { permissions: ["balance:read", "statement:read"] })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("updateAgent caps transfer_limit_minor at MAX (100_000)", async () => {
    const { updateAgent } = await import("../src/services/agentService");
    const updated = await updateAgent(agentUserId, agentId, { transfer_limit_minor: 999999 });
    expect(updated.transfer_limit_minor).toBe(100_000);
  });

  it("deleteAgent soft-deletes the agent", async () => {
    const { deleteAgent, getAgent, listAgents } = await import("../src/services/agentService");
    await deleteAgent(agentUserId, agentId);

    const fetched = await getAgent(agentUserId, agentId);
    expect(fetched).toBeNull();

    const list = await listAgents(agentUserId);
    expect(list.some((a) => a.id === agentId)).toBe(false);
  });

  it("deleteAgent throws NOT_FOUND for already-deleted agent", async () => {
    const { deleteAgent } = await import("../src/services/agentService");
    const { AppError } = await import("../src/errors");
    await expect(deleteAgent(agentUserId, agentId)).rejects.toBeInstanceOf(AppError);
  });
});

// ---------------------------------------------------------------------------
// requireTier middleware
// ---------------------------------------------------------------------------

describe("Phase 3: requireTier middleware", () => {
  let tier0UserId: string;
  let tier1UserId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { upgradeTier1 } = await import("../src/services/identityService");

    const u0 = await createUser("require-tier0@test.com", "Tier0");
    tier0UserId = u0.id;

    const u1 = await createUser("require-tier1@test.com", "Tier1");
    tier1UserId = u1.id;
    await upgradeTier1(tier1UserId, "+15550001111");
  });

  it("requireTier(1) blocks Tier 0 user with TIER_REQUIRED", async () => {
    const { requireTier } = await import("../src/middleware/requireTier");
    const { ErrorCode } = await import("../src/errors");

    let nextError: unknown;
    const req = { userId: tier0UserId } as Parameters<ReturnType<typeof requireTier>>[0];
    const res = {} as Parameters<ReturnType<typeof requireTier>>[1];
    const next = (err: unknown) => { nextError = err; };

    await requireTier(1)(req, res, next);
    expect((nextError as { code?: string })?.code).toBe(ErrorCode.TIER_REQUIRED);
  });

  it("requireTier(1) passes for Tier 1 user", async () => {
    const { requireTier } = await import("../src/middleware/requireTier");

    let nextCalledWithError = false;
    let nextCalledWithoutError = false;
    const req = { userId: tier1UserId } as Parameters<ReturnType<typeof requireTier>>[0];
    const res = {} as Parameters<ReturnType<typeof requireTier>>[1];
    const next = (err?: unknown) => {
      if (err) nextCalledWithError = true;
      else nextCalledWithoutError = true;
    };

    await requireTier(1)(req, res, next);
    expect(nextCalledWithoutError).toBe(true);
    expect(nextCalledWithError).toBe(false);
  });

  it("requireTier(0) passes for unauthenticated-but-resolved userId", async () => {
    const { requireTier } = await import("../src/middleware/requireTier");

    let nextCalledWithoutError = false;
    const req = { userId: tier0UserId } as Parameters<ReturnType<typeof requireTier>>[0];
    const res = {} as Parameters<ReturnType<typeof requireTier>>[1];
    const next = (err?: unknown) => { if (!err) nextCalledWithoutError = true; };

    await requireTier(0)(req, res, next);
    expect(nextCalledWithoutError).toBe(true);
  });

  it("requireTier blocks when userId is missing", async () => {
    const { requireTier } = await import("../src/middleware/requireTier");
    const { ErrorCode } = await import("../src/errors");

    let nextError: unknown;
    const req = {} as Parameters<ReturnType<typeof requireTier>>[0];
    const res = {} as Parameters<ReturnType<typeof requireTier>>[1];
    const next = (err: unknown) => { nextError = err; };

    await requireTier(1)(req, res, next);
    expect((nextError as { code?: string })?.code).toBe(ErrorCode.UNAUTHENTICATED);
  });
});
