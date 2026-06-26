/**
 * X-Money response F3 — P2P money requests (request-to-pay) on the native rail.
 *
 *   1. create → fulfill: payer debited, requester credited; settles via the ledger.
 *   2. fulfill is idempotent (the request can only ever pay once).
 *   3. directed request: only the named payer can fulfill; others are forbidden.
 *   4. decline / cancel: no money moves.
 *   5. can't fulfill your own request; insufficient funds is rejected.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-preq-${Date.now()}.db`;

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
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ } }
});

async function cashOf(userId: string): Promise<bigint> {
  const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
  return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USD"));
}
async function newUser(tag: string): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`preq-${tag}-${Date.now()}-${Math.random()}@test.com`, "P");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
  return u.id;
}

describe("P2P money requests (F3) — native, non-custodial rail", () => {
  it("create → fulfill: payer debited, requester credited", async () => {
    const { createRequest, fulfillRequest } = await import("../src/services/paymentRequestService");
    const alice = await newUser("a"); // requester
    const bob = await newUser("b"); // payer
    const aBefore = await cashOf(alice);
    const bBefore = await cashOf(bob);

    const req = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 2_500n, memo: "dinner" });
    expect(req.status).toBe("requested");

    const done = await fulfillRequest({ requestId: req.id, payerUserId: bob });
    expect(done.status).toBe("fulfilled");
    expect(done.fulfilledBy).toBe(bob);
    expect(done.journalId).toBeTruthy();
    expect(await cashOf(bob)).toBe(bBefore - 2_500n);
    expect(await cashOf(alice)).toBe(aBefore + 2_500n);
  });

  it("fulfill is idempotent — a request can only pay once", async () => {
    const { createRequest, fulfillRequest } = await import("../src/services/paymentRequestService");
    const alice = await newUser("a2");
    const bob = await newUser("b2");
    const req = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 1_000n });
    const first = await fulfillRequest({ requestId: req.id, payerUserId: bob });
    const bAfter = await cashOf(bob);
    const again = await fulfillRequest({ requestId: req.id, payerUserId: bob }); // retry
    expect(again.journalId).toBe(first.journalId); // same settlement
    expect(await cashOf(bob)).toBe(bAfter);          // not double-charged
  });

  it("directed request: only the named payer can fulfill", async () => {
    const { createRequest, fulfillRequest } = await import("../src/services/paymentRequestService");
    const { ErrorCode } = await import("../src/errors");
    const alice = await newUser("a3");
    const bob = await newUser("b3");
    const rando = await newUser("r3");
    const req = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 500n });
    await expect(fulfillRequest({ requestId: req.id, payerUserId: rando })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("decline and cancel move no money", async () => {
    const { createRequest, declineRequest, cancelRequest, fulfillRequest } = await import("../src/services/paymentRequestService");
    const { ErrorCode } = await import("../src/errors");
    const alice = await newUser("a4");
    const bob = await newUser("b4");

    const r1 = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 700n });
    const declined = await declineRequest({ requestId: r1.id, userId: bob });
    expect(declined.status).toBe("declined");
    await expect(fulfillRequest({ requestId: r1.id, payerUserId: bob })).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    const r2 = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 700n });
    const canceled = await cancelRequest({ requestId: r2.id, userId: alice });
    expect(canceled.status).toBe("canceled");
  });

  it("cannot request from yourself or pay your own request; insufficient funds is rejected", async () => {
    const { createRequest, fulfillRequest } = await import("../src/services/paymentRequestService");
    const { ErrorCode } = await import("../src/errors");
    const alice = await newUser("a5");
    const bob = await newUser("b5");
    await expect(createRequest({ requesterUserId: alice, fromUserId: alice, amountMinor: 100n })).rejects.toMatchObject({ code: ErrorCode.VALIDATION });

    const open = await createRequest({ requesterUserId: alice, amountMinor: 100n }); // open request
    await expect(fulfillRequest({ requestId: open.id, payerUserId: alice })).rejects.toMatchObject({ code: ErrorCode.VALIDATION }); // can't pay own

    const big = await createRequest({ requesterUserId: alice, fromUserId: bob, amountMinor: 9_999_999n });
    await expect(fulfillRequest({ requestId: big.id, payerUserId: bob })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
  });
});
