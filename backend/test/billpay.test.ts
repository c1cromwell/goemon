/**
 * Phase 19.3 — bill pay.
 *
 *   - add a payee; pay a bill now (debits user_cash via external_clearing), idempotent;
 *   - balance + freeze gates;
 *   - schedule for later → settled by the due-loop; a recurring payment seeds its next instance;
 *   - cancel a scheduled payment;
 *   - BILLPAY_ENABLED gates everything; productionFatals refuses it in prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { productionFatals } from "../src/config";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-billpay-${Date.now()}.db`;
let seq = 0;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { BILLPAY_ENABLED: boolean }).BILLPAY_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function userWithPayee() {
  const { createUser } = await import("../src/services/authService");
  const { addPayee } = await import("../src/services/billPayService");
  const user = await createUser(`bill-${seq++}-${Date.now()}@test.com`, "Bill User"); // $10,000 opening
  const payee = await addPayee({ userId: user.id, name: "City Power", category: "utility", last4: "4321" });
  return { user, payee };
}
async function cash(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}

describe("pay now", () => {
  it("debits user_cash and is idempotent on replay", async () => {
    const { payBill } = await import("../src/services/billPayService");
    const { user, payee } = await userWithPayee();
    const before = await cash(user.id);
    const key = `bp-${uuidv4()}`;
    const r1 = await payBill({ userId: user.id, payeeId: payee.id, amountMinor: 9_000n, idempotencyKey: key });
    expect(r1.status).toBe("sent");
    expect(await cash(user.id)).toBe(before - 9_000n);

    const r2 = await payBill({ userId: user.id, payeeId: payee.id, amountMinor: 9_000n, idempotencyKey: key });
    expect(r2.paymentId).toBe(r1.paymentId);
    expect(await cash(user.id)).toBe(before - 9_000n); // no double pay
  });

  it("rejects over-balance and a frozen account", async () => {
    const { payBill } = await import("../src/services/billPayService");
    const { placeHold } = await import("../src/services/accountHoldService");
    const { user, payee } = await userWithPayee();
    await expect(payBill({ userId: user.id, payeeId: payee.id, amountMinor: 99_999_999n, idempotencyKey: `bp-${uuidv4()}` })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
    await placeHold({ userId: user.id, reason: "test", source: "admin" });
    await expect(payBill({ userId: user.id, payeeId: payee.id, amountMinor: 100n, idempotencyKey: `bp-${uuidv4()}` })).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });
  });
});

describe("schedule + recurring + cancel", () => {
  it("schedules for later, settles via the due-loop, and seeds the next recurring instance", async () => {
    const { payBill, processScheduledBills, listPayments } = await import("../src/services/billPayService");
    const { user, payee } = await userWithPayee();
    const before = await cash(user.id);

    // Scheduled in the (near) future + monthly recurrence → not sent inline.
    const future = new Date(Date.now() + 5_000).toISOString();
    const r = await payBill({ userId: user.id, payeeId: payee.id, amountMinor: 1_500n, recurrence: "monthly", scheduledFor: future, idempotencyKey: `bp-${uuidv4()}` });
    expect(r.status).toBe("scheduled");
    expect(await cash(user.id)).toBe(before); // nothing moved yet

    // The due-loop with a cutoff past the scheduled time settles it.
    const res = await processScheduledBills(new Date(Date.now() + 10_000).toISOString());
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect(await cash(user.id)).toBe(before - 1_500n);

    const payments = await listPayments(user.id);
    expect(payments.some((p) => p.status === "sent")).toBe(true);
    expect(payments.some((p) => p.status === "scheduled" && p.recurrence === "monthly")).toBe(true); // next instance seeded
  });

  it("cancels a not-yet-sent payment", async () => {
    const { payBill, cancelBill } = await import("../src/services/billPayService");
    const { user, payee } = await userWithPayee();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const r = await payBill({ userId: user.id, payeeId: payee.id, amountMinor: 500n, scheduledFor: future, idempotencyKey: `bp-${uuidv4()}` });
    expect(r.status).toBe("scheduled");
    expect((await cancelBill(user.id, r.paymentId)).canceled).toBe(true);
  });
});

describe("kill-switch", () => {
  it("BILLPAY_ENABLED gates payments", async () => {
    const { payBill } = await import("../src/services/billPayService");
    const { config } = await import("../src/config");
    const { user, payee } = await userWithPayee();
    (config as { BILLPAY_ENABLED: boolean }).BILLPAY_ENABLED = false;
    try {
      await expect(payBill({ userId: user.id, payeeId: payee.id, amountMinor: 100n, idempotencyKey: `bp-${uuidv4()}` })).rejects.toMatchObject({ code: ErrorCode.BILLPAY_DISABLED });
    } finally {
      (config as { BILLPAY_ENABLED: boolean }).BILLPAY_ENABLED = true;
    }
  });

  it("productionFatals refuses BILLPAY_ENABLED in production", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false, BILLPAY_ENABLED: false,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("BILLPAY_ENABLED"))).toBe(false);
    const on = { ...base, BILLPAY_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("BILLPAY_ENABLED"))).toBe(true);
  });
});
