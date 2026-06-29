/**
 * Phase 22.0 — Goemon Starter households + guardian↔teen linkage + minor TIER_OPS.
 *
 *   - TEEN_ENABLED gates everything; productionFatals refuses it in prod;
 *   - guardian must be Tier 2 to create a household and link teens;
 *   - DOB must fall in the 13–17 band;
 *   - minors never receive transfer:high or lending:read regardless of tier;
 *   - guardian dashboard returns per-teen balance summaries.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-starter-${Date.now()}.db`;
let seq = 0;
function uniqEmail(prefix: string): string {
  return `${prefix}-${seq++}-${uuidv4()}@test.com`;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { TEEN_ENABLED: boolean }).TEEN_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TMP_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

async function tier2Guardian() {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const user = await createUser(uniqEmail("guardian"), "Guardian Parent");
  await getDb().execute(
    "UPDATE identity_profiles SET tier = 2, identity_status = 'kyc_passed' WHERE user_id = ?",
    [user.id]
  );
  return user;
}

describe("household lifecycle", () => {
  it("creates a household and links a teen with valid DOB", async () => {
    const { createHousehold, addTeen, getGuardianDashboard } = await import("../src/services/householdService");
    const guardian = await tier2Guardian();

    const household = await createHousehold(guardian.id, "Cromwell Family");
    expect(household.guardianUserId).toBe(guardian.id);
    expect(household.name).toBe("Cromwell Family");

    const teen = await addTeen({
      guardianUserId: guardian.id,
      email: uniqEmail("teen"),
      fullName: "Alex Teen",
      dob: "2010-06-15",
    });
    expect(teen.fullName).toBe("Alex Teen");
    expect(teen.balances.cash).toBe("0");
    expect(teen.allowedOps).not.toContain("transfer:high");
    expect(teen.allowedOps).not.toContain("lending:read");

    const dash = await getGuardianDashboard(guardian.id);
    expect(dash.household.id).toBe(household.id);
    expect(dash.teens).toHaveLength(1);
    expect(dash.teens[0]!.userId).toBe(teen.userId);
  });

  it("rejects household creation below Tier 2", async () => {
    const { createHousehold } = await import("../src/services/householdService");
    const { createUser } = await import("../src/services/authService");
    const user = await createUser(uniqEmail("t1"), "Tier One");
    await expect(createHousehold(user.id)).rejects.toMatchObject({ code: ErrorCode.TIER_REQUIRED });
  });

  it("rejects teen DOB outside 13–17", async () => {
    const { createHousehold, addTeen } = await import("../src/services/householdService");
    const guardian = await tier2Guardian();
    await createHousehold(guardian.id);

    await expect(
      addTeen({
        guardianUserId: guardian.id,
        email: uniqEmail("young"),
        fullName: "Too Young",
        dob: "2020-01-01",
      })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });

    await expect(
      addTeen({
        guardianUserId: guardian.id,
        email: uniqEmail("adult"),
        fullName: "Too Old",
        dob: "2000-01-01",
      })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });

  it("assertGuardianOfTeen denies unrelated guardians", async () => {
    const { createHousehold, addTeen, assertGuardianOfTeen } = await import("../src/services/householdService");
    const g1 = await tier2Guardian();
    const g2 = await tier2Guardian();
    await createHousehold(g1.id);
    const teen = await addTeen({
      guardianUserId: g1.id,
      email: uniqEmail("linked"),
      fullName: "Linked Teen",
      dob: "2011-03-20",
    });
    await expect(assertGuardianOfTeen(g2.id, teen.userId)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(assertGuardianOfTeen(g1.id, teen.userId)).resolves.toBeUndefined();
  });
});

describe("minor TIER_OPS override", () => {
  it("strips transfer:high and lending:read even at tier 4", async () => {
    const { getTierOpsForProfile } = await import("../src/services/identityService");
    const adultOps = getTierOpsForProfile({ tier: 4, account_type: "standard", is_minor: 0 });
    expect(adultOps).toContain("transfer:high");
    expect(adultOps).toContain("lending:read");

    const minorOps = getTierOpsForProfile({ tier: 4, account_type: "minor", is_minor: 1 });
    expect(minorOps).not.toContain("transfer:high");
    expect(minorOps).not.toContain("lending:read");
    expect(minorOps).toContain("transfer:low");
  });
});

describe("kill-switch", () => {
  it("TEEN_DISABLED when TEEN_ENABLED is off", async () => {
    const { config } = await import("../src/config");
    const { createHousehold } = await import("../src/services/householdService");
    (config as { TEEN_ENABLED: boolean }).TEEN_ENABLED = false;
    const guardian = await tier2Guardian();
    await expect(createHousehold(guardian.id)).rejects.toMatchObject({ code: ErrorCode.TEEN_DISABLED });
    (config as { TEEN_ENABLED: boolean }).TEEN_ENABLED = true;
  });

  it("productionFatals refuses TEEN_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(48),
      ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false,
      KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated",
      SMARTCHAT_ORCHESTRATOR: "simulated",
      OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "",
      HEDERA_ENABLED: false,
      TEEN_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("TEEN_ENABLED"))).toBe(false);
    const on = { ...base, TEEN_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("TEEN_ENABLED"))).toBe(true);
  });
});
