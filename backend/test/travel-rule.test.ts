/**
 * Travel Rule seam — $3k threshold + simulated transmission.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";

const TMP_DB = `./data/test-travel-rule-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { config } = await import("../src/config");
  (config as { TRAVEL_RULE_ENABLED: boolean }).TRAVEL_RULE_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("travel rule seam", () => {
  it("flags amounts at or above $3k", async () => {
    const { requiresTravelRule, TRAVEL_RULE_THRESHOLD_USD_MINOR } = await import("../src/services/travelRuleService");
    expect(requiresTravelRule(TRAVEL_RULE_THRESHOLD_USD_MINOR - 1n)).toBe(false);
    expect(requiresTravelRule(TRAVEL_RULE_THRESHOLD_USD_MINOR)).toBe(true);
  });

  it("transmits via simulated provider when enabled", async () => {
    const { transmitTravelRule } = await import("../src/services/travelRuleService");
    const result = await transmitTravelRule({
      originatorName: "Alice",
      originatorAccount: "0.0.1",
      beneficiaryName: "Bob",
      beneficiaryAccount: "0.0.2",
      amountMinor: 500_000n,
      currency: "USD",
    });
    expect(result.provider).toBe("simulated");
    expect(result.transmissionId).toMatch(/^sim-tr-/);
  });
});
