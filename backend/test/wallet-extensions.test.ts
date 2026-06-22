/**
 * Wallet extensions — HIP-583, CCTP, push notifications, mech-gov.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-wallet-ext-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { CCTP_ENABLED: boolean }).CCTP_ENABLED = true;
  (config as { TRAVEL_RULE_ENABLED: boolean }).TRAVEL_RULE_ENABLED = true;
  (config as { MECH_GOV_ENABLED: boolean }).MECH_GOV_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("wallet extensions seam", () => {
  it("derives HIP-583 EVM alias from Hedera account id", async () => {
    const { hederaAccountToEvmAddress } = await import("../src/utils/hip583");
    const id = "0.0.12345";
    const alias = hederaAccountToEvmAddress(id);
    expect(alias).toMatch(/^0x[0-9a-f]{40}$/);
    expect(alias.endsWith("3039")).toBe(true); // 12345 = 0x3039
  });

  it("CCTP simulated transfer is idempotent", async () => {
    const { getDb } = await import("../src/db");
    const { initiateCctpTransfer } = await import("../src/services/cctpService");
    const userId = uuidv4();
    await getDb().execute("INSERT INTO users (id, email) VALUES (?, ?)", [userId, `${userId}@test.com`]);

    const key = `cctp-${uuidv4()}`;
    const a = await initiateCctpTransfer({
      userId,
      direction: "in",
      sourceChain: "ethereum",
      amountMicro: 1_000_000n,
      idempotencyKey: key,
    });
    const b = await initiateCctpTransfer({
      userId,
      direction: "in",
      sourceChain: "ethereum",
      amountMicro: 1_000_000n,
      idempotencyKey: key,
    });
    expect(a.transferId).toBe(b.transferId);
  });

  it("registers push token and notifies via simulated provider", async () => {
    const { getDb } = await import("../src/db");
    const { registerDeviceToken, notifyUser, setPushProvider } = await import("../src/services/notificationService");
    const userId = uuidv4();
    await getDb().execute("INSERT INTO users (id, email) VALUES (?, ?)", [userId, `${userId}@test.com`]);

    const sent: string[] = [];
    setPushProvider({
      name: "test",
      async send(input) {
        sent.push(input.body);
      },
    });
    await registerDeviceToken({ userId, platform: "web", token: "tok-1" });
    const n = await notifyUser({ userId, category: "transactional", title: "Hi", body: "USDC received" });
    expect(n).toBe(1);
    expect(sent).toContain("USDC received");
    setPushProvider(null);
  });

  it("mech-gov R3 escalates approve to human gate for kyc-review", async () => {
    const { applyMechanicalGovernance } = await import("../src/integrations/mechGovService");
    const out = applyMechanicalGovernance({
      skill: "kyc-review",
      confidence: 0.95,
      gate: { action: "approve", reason: "ok" },
    });
    expect(out.escalated).toBe(true);
    expect(out.gate.action).toBe("escalate");
  });
});
