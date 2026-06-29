/**
 * Phase 21 Stage 1 — Goeman Pay rail tests (docs/business/PAYMENT-NETWORK-STRATEGY.md §4/§8).
 *
 *   1. GOEMAN_PAY_ENABLED is a kill-switch (off ⇒ PAY_DISABLED on new intents/payments)
 *      — but held funds remain resolvable (capture works while the switch is off).
 *   2. Request → pay → capture: payer debited at pay (escrow-held), merchant owner
 *      credited only at capture, zero rail fee.
 *   3. Single-payment invariant: re-pay by the same payer is idempotent; a second
 *      payer is rejected with CONFLICT and never moves funds.
 *   4. Refund makes the payer whole.
 *   5. Dispute holds funds; mediated resolution (the escrow admin path) flows back
 *      into the intent's derived status.
 *   6. Expired intents are not payable; cancel only before payment.
 *   7. payment_events is append-only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-payments-${Date.now()}.db`;

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

async function setPayEnabled(on: boolean) {
  const { config } = await import("../src/config");
  (config as { GOEMAN_PAY_ENABLED: boolean }).GOEMAN_PAY_ENABLED = on;
}

describe("Phase 21 Stage 1: Goeman Pay rail", () => {
  let owner: string; // merchant owner (the settlement account)
  let payer: string;
  let rival: string; // a second would-be payer
  let merchantId: string;

  async function balances() {
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const o = await getOrCreateUserAccount(owner, "user_cash", "USD");
    const p = await getOrCreateUserAccount(payer, "user_cash", "USD");
    return { owner: await getBalance(o), payer: await getBalance(p) };
  }

  async function newIntent(amount: bigint, key: string, ttlSecs?: number) {
    const { createPaymentIntent } = await import("../src/services/paymentService");
    return createPaymentIntent({
      merchantId,
      actorUserId: owner,
      amountMinor: amount,
      currency: "USD",
      ttlSecs,
      idempotencyKey: key,
    });
  }

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations();
    const { initTokenFactory } = await import("../src/utils/tokenFactory");
    await initTokenFactory();
    const { bootstrapSystemAccounts, getOrCreateUserAccount } = await import("../src/services/ledgerService");
    await bootstrapSystemAccounts();
    await setPayEnabled(true);

    const { createUser } = await import("../src/services/authService");
    for (const [email, name] of [
      ["owner@pay.test", "Merchant Owner"],
      ["payer@pay.test", "Payer"],
      ["rival@pay.test", "Rival"],
    ] as const) {
      const u = await createUser(email, name);
      await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
      if (email.startsWith("owner")) owner = u.id;
      if (email.startsWith("payer")) payer = u.id;
      if (email.startsWith("rival")) rival = u.id;
    }

    const { createMerchant } = await import("../src/services/paymentService");
    const m = await createMerchant(owner, "Quiet Coffee Co");
    merchantId = m.id;
  });

  it("kill-switch: off ⇒ PAY_DISABLED on new intents/payments; held funds stay resolvable", async () => {
    const { payIntent, captureIntent } = await import("../src/services/paymentService");
    const { ErrorCode } = await import("../src/errors");

    // A payment already held BEFORE the switch goes off…
    const pre = await newIntent(1_000n, "ks-pre");
    await payIntent({ intentId: pre.id, payerUserId: payer, authorizedVia: "user" });

    await setPayEnabled(false);
    try {
      await expect(newIntent(1_000n, "ks-1")).rejects.toMatchObject({ code: ErrorCode.PAY_DISABLED });
      await expect(
        payIntent({ intentId: pre.id, payerUserId: rival, authorizedVia: "user" })
      ).rejects.toMatchObject({ code: ErrorCode.PAY_DISABLED });
      // …can still be captured: shedding the rail never strands money.
      const captured = await captureIntent(pre.id, owner);
      expect(captured.status).toBe("settled");
    } finally {
      await setPayEnabled(true);
    }
  });

  it("request → pay → capture: escrow-held at pay, merchant credited at capture, zero fee", async () => {
    const { payIntent, captureIntent } = await import("../src/services/paymentService");
    const before = await balances();

    const intent = await newIntent(25_000n, "happy-1");
    expect(intent.status).toBe("requires_payment");

    const paid = await payIntent({ intentId: intent.id, payerUserId: payer, authorizedVia: "user" });
    expect(paid.status).toBe("held");
    expect(paid.escrowId).toBeTruthy();
    const mid = await balances();
    expect(before.payer - mid.payer).toBe(25_000n); // payer debited into escrow
    expect(mid.owner).toBe(before.owner); // merchant not yet credited

    const captured = await captureIntent(intent.id, owner);
    expect(captured.status).toBe("settled");
    const after = await balances();
    expect(after.owner - before.owner).toBe(25_000n); // full amount — no interchange
    expect(after.payer).toBe(before.payer - 25_000n);
  });

  it("single payment: same payer is idempotent; a second payer gets CONFLICT, funds untouched", async () => {
    const { payIntent } = await import("../src/services/paymentService");
    const { ErrorCode } = await import("../src/errors");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const intent = await newIntent(5_000n, "single-1");
    const first = await payIntent({ intentId: intent.id, payerUserId: payer, authorizedVia: "user" });
    const again = await payIntent({ intentId: intent.id, payerUserId: payer, authorizedVia: "user" });
    expect(again.escrowId).toBe(first.escrowId); // idempotent — one escrow, one journal

    const rivalAcct = await getOrCreateUserAccount(rival, "user_cash", "USD");
    const rivalBefore = await getBalance(rivalAcct);
    await expect(
      payIntent({ intentId: intent.id, payerUserId: rival, authorizedVia: "user" })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(await getBalance(rivalAcct)).toBe(rivalBefore); // rival never moved money
  });

  it("refund makes the payer whole", async () => {
    const { payIntent, refundIntent } = await import("../src/services/paymentService");
    const before = await balances();
    const intent = await newIntent(8_000n, "refund-1");
    await payIntent({ intentId: intent.id, payerUserId: payer, authorizedVia: "user" });
    const refunded = await refundIntent(intent.id, owner);
    expect(refunded.status).toBe("refunded");
    const after = await balances();
    expect(after.payer).toBe(before.payer);
    expect(after.owner).toBe(before.owner);
  });

  it("dispute holds funds; mediated escrow resolution flows back into the intent", async () => {
    const { payIntent, disputeIntent, getIntent } = await import("../src/services/paymentService");
    const { resolveDispute } = await import("../src/services/escrowService");

    const intent = await newIntent(6_000n, "dispute-1");
    const paid = await payIntent({ intentId: intent.id, payerUserId: payer, authorizedVia: "user" });
    const disputed = await disputeIntent(intent.id, payer, "goods not delivered");
    expect(disputed.status).toBe("disputed");

    // The mediator resolves on the existing escrow admin surface…
    await resolveDispute(paid.escrowId!, "refund", "mediator");
    // …and the intent's derived status follows the escrow with no extra sync.
    expect((await getIntent(intent.id))!.status).toBe("refunded");
  });

  it("expired intents are not payable; cancel only before payment", async () => {
    const { payIntent, cancelIntent, captureIntent } = await import("../src/services/paymentService");
    const { ErrorCode } = await import("../src/errors");
    const { getDb } = await import("../src/db");

    const stale = await newIntent(1_000n, "expire-1");
    await getDb().execute("UPDATE payment_intents SET expires_at = ? WHERE id = ?", [
      new Date(Date.now() - 1000).toISOString(),
      stale.id,
    ]);
    await expect(
      payIntent({ intentId: stale.id, payerUserId: payer, authorizedVia: "user" })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    const cancelable = await newIntent(1_000n, "cancel-1");
    const canceled = await cancelIntent(cancelable.id, owner);
    expect(canceled.status).toBe("canceled");

    const paidOne = await newIntent(1_000n, "cancel-2");
    await payIntent({ intentId: paidOne.id, payerUserId: payer, authorizedVia: "user" });
    await expect(cancelIntent(paidOne.id, owner)).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    await captureIntent(paidOne.id, owner); // clean up: settle the held funds
  });

  it("payment_events is append-only", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE payment_events SET event = 'tamper' WHERE event = 'paid'")
    ).rejects.toThrow(/append-only/i);
  });
});
