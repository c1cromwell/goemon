/**
 * Phase 20 — Ledger⇄chain reconciliation tests (closes Phase-14 invariant n).
 *
 *   1. No chain-balance provider ⇒ the run records `skipped` and does not gate.
 *   2. Ledger == chain ⇒ `ok`, no findings, settlement ungated.
 *   3. Per-user drift ⇒ `drift` + a finding with the exact delta, and on-chain
 *      settlement is GATED (assertSettlementUngated throws RECONCILIATION_HOLD).
 *   4. Escrow-custodian coverage: operator on-chain < escrow ledger ⇒ drift;
 *      restored coverage + clean re-run ⇒ ungated again.
 *   5. A provider failure records an `error` run and does NOT gate settlement.
 *   6. reconciliation_runs / reconciliation_findings are append-only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-recon-${Date.now()}.db`;
const USER_HEDERA_ID = "0.0.1001";
const OPERATOR_ID = "0.0.9999";

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

// In-memory stand-in for the Hedera Mirror Node.
const chain = new Map<string, bigint>();
const fakeProvider = {
  async getUsdcBalanceMicro(hederaAccountId: string): Promise<bigint> {
    return chain.get(hederaAccountId) ?? 0n;
  },
};

describe("Phase 20: ledger⇄chain reconciliation", () => {
  let userId: string;

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations();
    const { initTokenFactory } = await import("../src/utils/tokenFactory");
    await initTokenFactory();
    const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
    await bootstrapSystemAccounts();

    // Deterministic operator id for the custodian-coverage check, regardless of .env.
    const { config } = await import("../src/config");
    (config as { HEDERA_OPERATOR_ID?: string }).HEDERA_OPERATOR_ID = OPERATOR_ID;

    const { createUser } = await import("../src/services/authService");
    const u = await createUser("recon@argus.test", "Recon User");
    userId = u.id;

    // The user has an on-chain account and a funded USDC ledger balance.
    const { getDb } = await import("../src/db");
    await getDb().execute(
      "INSERT INTO hedera_accounts (id, user_id, hedera_account_id, public_key) VALUES (?, ?, ?, 'pk')",
      ["recon-ha-1", userId, USER_HEDERA_ID]
    );
    const { getOrCreateUserAccount, getSystemAccount, postJournal } = await import("../src/services/ledgerService");
    const userUsdc = await getOrCreateUserAccount(userId, "user_cash", "USDC");
    const settlement = await getSystemAccount("bank_settlement", "USDC");
    await postJournal(
      [
        { ledgerAccountId: settlement, direction: "debit", amountMinor: 5_000_000n, currency: "USDC" },
        { ledgerAccountId: userUsdc, direction: "credit", amountMinor: 5_000_000n, currency: "USDC" },
      ],
      "Test USDC funding"
    );
  });

  it("no provider ⇒ run is `skipped` and settlement is not gated", async () => {
    const { setChainBalanceProvider, runReconciliation, isSettlementGated } = await import(
      "../src/services/reconciliationService"
    );
    setChainBalanceProvider(null);
    const run = await runReconciliation();
    expect(run.result).toBe("skipped");
    expect(await isSettlementGated()).toBe(false);
  });

  it("ledger == chain ⇒ `ok`, no findings, settlement ungated", async () => {
    const { setChainBalanceProvider, runReconciliation, assertSettlementUngated } = await import(
      "../src/services/reconciliationService"
    );
    setChainBalanceProvider(fakeProvider);
    chain.set(USER_HEDERA_ID, 5_000_000n);
    chain.set(OPERATOR_ID, 0n);

    const run = await runReconciliation();
    expect(run.result).toBe("ok");
    expect(run.driftCount).toBe(0);
    expect(run.accountsChecked).toBe(2); // user + escrow custodian
    await expect(assertSettlementUngated()).resolves.toBeUndefined();
  });

  it("per-user drift ⇒ flagged with the exact delta, and settlement is GATED", async () => {
    const { runReconciliation, isSettlementGated, assertSettlementUngated, getLatestRun } = await import(
      "../src/services/reconciliationService"
    );
    const { ErrorCode } = await import("../src/errors");

    chain.set(USER_HEDERA_ID, 4_000_000n); // 1 USDC missing on-chain
    const run = await runReconciliation();
    expect(run.result).toBe("drift");
    expect(run.driftCount).toBe(1);
    expect(run.findings[0]).toMatchObject({
      subject: `user:${userId}`,
      hederaAccountId: USER_HEDERA_ID,
      ledgerMinor: "5000000",
      chainMinor: "4000000",
      driftMinor: "-1000000",
    });

    expect(await isSettlementGated()).toBe(true);
    await expect(assertSettlementUngated()).rejects.toMatchObject({ code: ErrorCode.RECONCILIATION_HOLD });

    // The latest-run read surface reports the same findings.
    const latest = await getLatestRun();
    expect(latest?.id).toBe(run.id);
    expect(latest?.findings).toHaveLength(1);
  });

  it("custodian shortfall ⇒ drift; restored coverage + clean re-run ⇒ ungated", async () => {
    const { runReconciliation, isSettlementGated } = await import("../src/services/reconciliationService");
    const { getOrCreateUserAccount, getSystemAccount, postJournal } = await import("../src/services/ledgerService");

    // Fix the user-side drift, then put 2 USDC into ledger escrow with only 1 at the operator.
    chain.set(USER_HEDERA_ID, 5_000_000n);
    const userUsdc = await getOrCreateUserAccount(userId, "user_cash", "USDC");
    const escrowAcct = await getSystemAccount("escrow", "USDC");
    await postJournal(
      [
        { ledgerAccountId: userUsdc, direction: "debit", amountMinor: 2_000_000n, currency: "USDC" },
        { ledgerAccountId: escrowAcct, direction: "credit", amountMinor: 2_000_000n, currency: "USDC" },
      ],
      "Test escrow hold"
    );
    chain.set(USER_HEDERA_ID, 3_000_000n); // user's chain balance drops with the hold
    chain.set(OPERATOR_ID, 1_000_000n); // under-collateralized custodian

    const short = await runReconciliation();
    expect(short.result).toBe("drift");
    expect(short.findings[0]).toMatchObject({ subject: "escrow_custodian", driftMinor: "-1000000" });
    expect(await isSettlementGated()).toBe(true);

    // Coverage restored (over-coverage is fine — the operator holds fee float too).
    chain.set(OPERATOR_ID, 2_500_000n);
    const clean = await runReconciliation();
    expect(clean.result).toBe("ok");
    expect(await isSettlementGated()).toBe(false);
  });

  it("provider failure ⇒ `error` run, settlement NOT gated", async () => {
    const { setChainBalanceProvider, runReconciliation, isSettlementGated } = await import(
      "../src/services/reconciliationService"
    );
    setChainBalanceProvider({
      async getUsdcBalanceMicro() {
        throw new Error("mirror node unreachable");
      },
    });
    const run = await runReconciliation();
    expect(run.result).toBe("error");
    expect(await isSettlementGated()).toBe(false);
    setChainBalanceProvider(fakeProvider);
  });

  it("reconciliation history is append-only", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE reconciliation_runs SET result = 'ok' WHERE result = 'drift'")
    ).rejects.toThrow(/append-only/i);
    await expect(
      getDb().execute("DELETE FROM reconciliation_findings")
    ).rejects.toThrow(/append-only/i);
  });
});
