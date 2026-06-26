/**
 * X-Money response F6 — cross-border send (remittance) on the native rail.
 *
 *   1. quoteCorridor previews the recipient amount (no money moves).
 *   2. send: sender's FROM debited; recipient's TO credited net; FX spread captured —
 *      one balanced journal across two currency groups (USD → EURC corridor).
 *   3. idempotent on the key; insufficient funds, same-currency, same-user rejected.
 *   4. FX_SETTLEMENT_ENABLED off ⇒ disabled.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-xborder-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { config } = await import("../src/config");
  (config as { FX_ENABLED: boolean }).FX_ENABLED = true;
  (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
  (config as { FX_SPREAD_BPS: number }).FX_SPREAD_BPS = 50;
  const { __setEnabledForTest } = await import("../src/services/currencyRegistry");
  __setEnabledForTest("EURC", true); // the recipient corridor currency
});

afterAll(async () => {
  const { __setEnabledForTest } = await import("../src/services/currencyRegistry");
  __setEnabledForTest("EURC", false);
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function bal(userId: string, ccy: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", ccy));
}
async function newUser(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`xb-${Date.now()}-${Math.random()}@test.com`, "X");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  return u.id;
}

describe("Cross-border send (F6) — remittance on the native rail", () => {
  it("quoteCorridor previews the recipient amount without moving money", async () => {
    const { quoteCorridor } = await import("../src/services/crossBorderService");
    const q = await quoteCorridor({ from: "USD", to: "EURC", amountMinor: 10_000n });
    expect(q.from).toBe("USD");
    expect(q.to).toBe("EURC");
    expect(q.toAmountMinor).toBe("92592500"); // $100 → ~92.59 EURC (mid)
  });

  it("send: sender debited, recipient credited net, FX spread captured (one balanced journal)", async () => {
    const { send } = await import("../src/services/crossBorderService");
    const { getOrCreateSystemAccount, getBalance } = await import("../src/services/ledgerService");
    const sender = await newUser();
    const recipient = await newUser();
    const senderUsdBefore = await bal(sender, "USD");

    const r = await send({ senderUserId: sender, recipientUserId: recipient, from: "USD", to: "EURC", fromAmountMinor: 10_000n, idempotencyKey: uuidv4() });
    // gross 92_592_500; fee = floor(92592500 × 0.5%) = 462_962; net = 92_129_538.
    expect(r.grossToMinor).toBe("92592500");
    expect(r.feeMinor).toBe("462962");
    expect(r.toAmountMinor).toBe("92129538");

    expect(await bal(sender, "USD")).toBe(senderUsdBefore - 10_000n); // FROM debited
    expect(await bal(recipient, "EURC")).toBe(92_129_538n);            // recipient receives net EURC
    const feeAcct = await getOrCreateSystemAccount("fee", "EURC");
    expect(await getBalance(feeAcct)).toBeGreaterThanOrEqual(462_962n); // spread captured
  });

  it("idempotent on the key (no double send)", async () => {
    const { send } = await import("../src/services/crossBorderService");
    const sender = await newUser();
    const recipient = await newUser();
    const before = await bal(sender, "USD");
    const key = uuidv4();
    const a = await send({ senderUserId: sender, recipientUserId: recipient, from: "USD", to: "EURC", fromAmountMinor: 5_000n, idempotencyKey: key });
    const b = await send({ senderUserId: sender, recipientUserId: recipient, from: "USD", to: "EURC", fromAmountMinor: 5_000n, idempotencyKey: key });
    expect(b.journalId).toBe(a.journalId);
    expect(await bal(sender, "USD")).toBe(before - 5_000n); // debited once
  });

  it("rejects insufficient funds, same-currency, and same-user", async () => {
    const { send } = await import("../src/services/crossBorderService");
    const { ErrorCode } = await import("../src/errors");
    const sender = await newUser();
    const recipient = await newUser();
    await expect(send({ senderUserId: sender, recipientUserId: recipient, from: "USD", to: "EURC", fromAmountMinor: 999_999_999n, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
    await expect(send({ senderUserId: sender, recipientUserId: recipient, from: "USD", to: "USD", fromAmountMinor: 100n, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.VALIDATION });
    await expect(send({ senderUserId: sender, recipientUserId: sender, from: "USD", to: "EURC", fromAmountMinor: 100n, idempotencyKey: uuidv4() }))
      .rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });

  it("FX_SETTLEMENT_ENABLED off ⇒ disabled", async () => {
    const { config } = await import("../src/config");
    const { send } = await import("../src/services/crossBorderService");
    const { ErrorCode } = await import("../src/errors");
    (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = false;
    try {
      await expect(send({ senderUserId: "a", recipientUserId: "b", from: "USD", to: "EURC", fromAmountMinor: 100n, idempotencyKey: uuidv4() }))
        .rejects.toMatchObject({ code: ErrorCode.FX_DISABLED });
    } finally {
      (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
    }
  });
});
