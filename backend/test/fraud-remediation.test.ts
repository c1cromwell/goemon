/**
 * Phase 20 fraud add-on — Goemon integration tests.
 *
 * Verifies the hybrid wiring to the standalone fraud engine WITHOUT a network
 * (the fraud client is injected with a fake):
 *   1. Triage: a benign transfer is emitted fire-and-forget (no sync call) and settles.
 *   2. Triage: an elevated transfer is screened synchronously; a remote `block`
 *      escalates a local `flag` to FRAUD_BLOCKED and records the remote model version.
 *   3. Degrade-open: when the engine returns nothing on the sync path, the local
 *      (non-block) decision stands and the transfer settles.
 *   4. Freeze: a frozen sender cannot transfer (ACCOUNT_FROZEN); unfreeze restores it.
 *   5. Remediation route: requires the service bearer; freeze is idempotent on decisionId.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import express from "express";

const TMP_DB = `./data/test-fraud-rem-${Date.now()}.db`;
const SERVICE_KEY = "test_service_key_at_least_32_chars_long_xx";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.FRAUD_ENGINE_API_KEY = SERVICE_KEY;
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

// --- Injected fake fraud client -------------------------------------------
interface RemoteDecision {
  decisionId: string;
  score: number;
  action: "allow" | "flag" | "challenge" | "block" | "freeze";
  reasons: { code: string; weight: number }[];
  modelVersion: string;
}
class FakeFraudClient {
  syncCalls = 0;
  asyncCalls = 0;
  nextSync: RemoteDecision | null = null;
  async scoreSync() {
    this.syncCalls++;
    return this.nextSync;
  }
  async emitAsync() {
    this.asyncCalls++;
  }
}

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
}

describe("fraud add-on: triage + remote merge", () => {
  let alice: string, bob: string, carol: string, dave: string, erin: string;
  let fake: FakeFraudClient;

  beforeAll(async () => {
    await setup();
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const ids: Record<string, string> = {};
    for (const [email, name] of [
      ["alice@rem.test", "Alice"],
      ["bob@rem.test", "Bob"],
      ["carol@rem.test", "Carol"],
      ["dave@rem.test", "Dave"],
      ["erin@rem.test", "Erin"],
    ] as const) {
      const u = await createUser(email, name);
      await getOrCreateUserAccount(u.id, "user_cash", "USD");
      ids[name.toLowerCase()] = u.id;
    }
    alice = ids.alice!; bob = ids.bob!; carol = ids.carol!; dave = ids.dave!; erin = ids.erin!;

    const { setFraudClient } = await import("../src/services/fraudClient");
    fake = new FakeFraudClient();
    setFraudClient(fake as unknown as Parameters<typeof setFraudClient>[0]);
  });

  it("emits a benign transfer fire-and-forget (no sync call) and settles", async () => {
    const { transfer } = await import("../src/services/transferService");
    fake.syncCalls = 0; fake.asyncCalls = 0;
    await transfer({ fromUserId: alice, toUserId: bob, amountMinor: 5_000n, currency: "USD", idempotencyKey: "rem-benign" });
    expect(fake.asyncCalls).toBe(1);
    expect(fake.syncCalls).toBe(0);
  });

  it("screens an elevated transfer synchronously; remote block escalates to FRAUD_BLOCKED", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");
    const { getDb } = await import("../src/db");
    fake.syncCalls = 0;
    // $9,000 to a new payee with no history → local large_absolute=flag (elevated → sync path).
    fake.nextSync = { decisionId: "rd-1", score: 0.95, action: "block", reasons: [{ code: "pass_through", weight: 0.4 }], modelVersion: "rules-v1+seq-v0" };
    await expect(
      transfer({ fromUserId: carol, toUserId: dave, amountMinor: 900_000n, currency: "USD", idempotencyKey: "rem-escalate" })
    ).rejects.toMatchObject({ code: ErrorCode.FRAUD_BLOCKED });
    expect(fake.syncCalls).toBe(1);

    const row = await getDb().queryOne<{ action: string; model_version: string }>(
      "SELECT action, model_version FROM fraud_decisions WHERE idempotency_key = ?",
      ["rem-escalate"]
    );
    expect(row?.action).toBe("block");
    expect(row?.model_version).toContain("rules-v1+seq-v0"); // remote version recorded
  });

  it("degrades open: a null remote opinion leaves the local (non-block) decision to settle", async () => {
    const { transfer } = await import("../src/services/transferService");
    const { getUserBalances } = await import("../src/services/ledgerService");
    fake.nextSync = null; // engine unreachable / no opinion
    // carol → erin, $9,000: local flag (large_absolute), remote null → effective flag → settles.
    await transfer({ fromUserId: carol, toUserId: erin, amountMinor: 900_000n, currency: "USD", idempotencyKey: "rem-degrade" });
    const bal = await getUserBalances(carol);
    // carol started $10,000; rem-escalate was blocked (not posted); rem-degrade posts $9,000.
    expect(bal.cash).toBe(100_000n);
  });
});

describe("fraud add-on: account freeze enforcement", () => {
  let frank: string, gina: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const f = await createUser("frank@rem.test", "Frank");
    const g = await createUser("gina@rem.test", "Gina");
    await getOrCreateUserAccount(f.id, "user_cash", "USD");
    await getOrCreateUserAccount(g.id, "user_cash", "USD");
    frank = f.id; gina = g.id;
  });

  it("blocks a frozen sender with ACCOUNT_FROZEN, then allows after unfreeze", async () => {
    const { placeHold, releaseHold, isAccountFrozen } = await import("../src/services/accountHoldService");
    const { transfer } = await import("../src/services/transferService");
    const { ErrorCode } = await import("../src/errors");

    await placeHold({ userId: frank, reason: "test", source: "fraud_engine", decisionId: "freeze-1" });
    expect(await isAccountFrozen(frank)).toBe(true);

    await expect(
      transfer({ fromUserId: frank, toUserId: gina, amountMinor: 5_000n, currency: "USD", idempotencyKey: "frozen-attempt" })
    ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_FROZEN });

    await releaseHold({ userId: frank, reason: "cleared", source: "admin" });
    expect(await isAccountFrozen(frank)).toBe(false);

    const r = await transfer({ fromUserId: frank, toUserId: gina, amountMinor: 5_000n, currency: "USD", idempotencyKey: "thawed-attempt" });
    expect(r.journalId).toBeTruthy();
  });

  it("placeHold is idempotent on decisionId", async () => {
    const { placeHold } = await import("../src/services/accountHoldService");
    const a = await placeHold({ userId: gina, reason: "x", source: "fraud_engine", decisionId: "dup-1" });
    const b = await placeHold({ userId: gina, reason: "x", source: "fraud_engine", decisionId: "dup-1" });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
  });
});

describe("fraud add-on: remediation route (service auth)", () => {
  let server: Server;
  let base: string;
  let userId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const u = await createUser("heidi@rem.test", "Heidi");
    userId = u.id;

    const { internalRemediationRouter } = await import("../src/routes/internalRemediation");
    const app = express();
    app.use(express.json());
    app.use("/api/internal/remediation", internalRemediationRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => server?.close());

  it("rejects a freeze without the service bearer", async () => {
    const res = await fetch(`${base}/api/internal/remediation/freeze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    expect(res.status).toBe(401);
  });

  it("freezes via the engine callback with the service bearer (idempotent)", async () => {
    const { isAccountFrozen } = await import("../src/services/accountHoldService");
    const headers = { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` };
    const body = JSON.stringify({ userId, reason: "engine", decisionId: "route-dec-1" });

    const r1 = await fetch(`${base}/api/internal/remediation/freeze`, { method: "POST", headers, body });
    expect(r1.status).toBe(200);
    expect((await r1.json()).applied).toBe(true);
    expect(await isAccountFrozen(userId)).toBe(true);

    const r2 = await fetch(`${base}/api/internal/remediation/freeze`, { method: "POST", headers, body });
    expect((await r2.json()).applied).toBe(false); // idempotent on decisionId
  });
});
