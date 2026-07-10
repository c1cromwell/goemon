/**
 * Phase 20 — Ledger⇄chain reconciliation (closes Phase-14 invariant n).
 *
 * Compares the double-entry ledger's USDC projection against on-chain balances
 * and flags drift:
 *   * per-user: user_cash/USDC ledger balance vs the user's on-chain USDC
 *   * escrow custodian: the operator's on-chain USDC must COVER the `escrow`
 *     system account's ledger balance (USDC holds park at the operator — see
 *     hederaService escrow primitives). Over-coverage is fine (the operator
 *     also holds fee float); a shortfall is drift.
 *
 * Chain balances come from a pluggable ChainBalanceProvider — the Hedera Mirror
 * Node REST API in real deployments, an injected fake in tests, none when
 * HEDERA_ENABLED=false (the run records `skipped`).
 *
 * Drift GATES on-chain settlement: hederaService calls assertSettlementUngated()
 * before submitting any USDC transfer, and it throws RECONCILIATION_HOLD until a
 * clean run supersedes the drifted one. Runs + findings are append-only history.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getSystemAccount, getBalance } from "./ledgerService";
import { reconciliationRunTotal, reconciliationDriftAccounts } from "../observability/metrics";

export interface ChainBalanceProvider {
  /** On-chain USDC balance (micro-units) of a Hedera account. */
  getUsdcBalanceMicro(hederaAccountId: string): Promise<bigint>;
}

let provider: ChainBalanceProvider | null = null;

/** Inject the chain-balance source (tests) or clear it (null ⇒ runs are skipped). */
export function setChainBalanceProvider(p: ChainBalanceProvider | null): void {
  provider = p;
}

/** Test/tuning knobs for the Mirror Node provider (defaults are the production values). */
export interface MirrorNodeOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  timeoutMs?: number;
}

/**
 * Hedera Mirror Node REST provider (read-only; no SDK client/keys needed).
 *
 * The public node is rate-limited (~50 req/s) and returns transient 429/5xx, so requests use a
 * bounded exponential backoff (200ms·400ms…, capped) with a per-attempt timeout; 4xx (other than
 * 429) fail fast. Injectable fetch/sleep make it unit-testable without network or real delays.
 */
export function mirrorNodeProvider(opts: MirrorNodeOptions = {}): ChainBalanceProvider {
  const base =
    opts.baseUrl ??
    (config.HEDERA_NETWORK === "mainnet"
      ? "https://mainnet-public.mirrornode.hedera.com"
      : `https://${config.HEDERA_NETWORK}.mirrornode.hedera.com`);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function getJson(url: string): Promise<unknown> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(Math.min(2000, 200 * 2 ** (i - 1)));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(url, { signal: ctrl.signal });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new AppError(ErrorCode.INTERNAL, `Mirror node ${res.status}`);
          continue; // transient — retry
        }
        if (!res.ok) throw new AppError(ErrorCode.INTERNAL, `Mirror node ${res.status}`); // 4xx — fail fast
        return await res.json();
      } catch (e) {
        if (e instanceof AppError) throw e; // non-retryable
        lastErr = e; // network/timeout — retry
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new AppError(ErrorCode.INTERNAL, "Mirror node request failed");
  }

  return {
    async getUsdcBalanceMicro(hederaAccountId: string): Promise<bigint> {
      const url = `${base}/api/v1/accounts/${hederaAccountId}/tokens?token.id=${config.HEDERA_USDC_TOKEN_ID}`;
      const body = (await getJson(url)) as { tokens?: { balance?: number | string }[] };
      const balance = body.tokens?.[0]?.balance;
      return balance == null ? 0n : BigInt(balance);
    },
  };
}

/** Wire the default provider. Call once at boot (after config is loaded). */
export function initReconciliation(): void {
  if (config.HEDERA_ENABLED && config.HEDERA_USDC_TOKEN_ID) {
    provider = mirrorNodeProvider();
  }
}

export interface ReconciliationFinding {
  subject: string;
  hederaAccountId: string | null;
  ledgerMinor: string;
  chainMinor: string;
  driftMinor: string;
}

export interface ReconciliationRun {
  id: string;
  result: "ok" | "drift" | "skipped" | "error";
  accountsChecked: number;
  driftCount: number;
  findings: ReconciliationFinding[];
  createdAt: string;
}

async function recordRun(
  result: ReconciliationRun["result"],
  accountsChecked: number,
  findings: ReconciliationFinding[],
  detail: Record<string, unknown>
): Promise<ReconciliationRun> {
  const db = getDb();
  const runId = uuidv4();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO reconciliation_runs (id, scope, result, accounts_checked, drift_count, detail, created_at)
       VALUES (?, 'usdc', ?, ?, ?, ?, ?)`,
      [runId, result, accountsChecked, findings.length, JSON.stringify(detail), now]
    );
    for (const f of findings) {
      await tx.execute(
        `INSERT INTO reconciliation_findings (id, run_id, subject, hedera_account_id, ledger_minor, chain_minor, drift_minor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), runId, f.subject, f.hederaAccountId, BigInt(f.ledgerMinor), BigInt(f.chainMinor), BigInt(f.driftMinor), now]
      );
    }
  });
  reconciliationRunTotal.inc({ result });
  reconciliationDriftAccounts.set(findings.length);
  await logAudit({
    action: "reconciliation.run",
    resource: runId,
    status: result === "drift" ? "blocked" : "success",
    details: { result, accountsChecked, driftCount: findings.length },
  });
  return { id: runId, result, accountsChecked, driftCount: findings.length, findings, createdAt: now };
}

/**
 * Run one reconciliation pass. Never throws on drift — drift is the *finding*;
 * provider failures record an `error` run (which does not gate settlement).
 */
export async function runReconciliation(): Promise<ReconciliationRun> {
  if (!provider) {
    return recordRun("skipped", 0, [], { reason: "no chain-balance provider (HEDERA_ENABLED=false)" });
  }

  const db = getDb();
  const findings: ReconciliationFinding[] = [];
  let accountsChecked = 0;

  try {
    // Per-user: ledger user_cash/USDC vs the user's on-chain USDC.
    const accounts = await db.query<{ user_id: string; hedera_account_id: string }>(
      "SELECT user_id, hedera_account_id FROM hedera_accounts WHERE hedera_account_id IS NOT NULL"
    );
    for (const a of accounts) {
      const ledgerAcct = await db.queryOne<{ id: string }>(
        "SELECT id FROM ledger_accounts WHERE user_id = ? AND kind = 'user_cash' AND currency = 'USDC'",
        [a.user_id]
      );
      const ledger = ledgerAcct ? await getBalance(ledgerAcct.id) : 0n;
      const chain = await provider.getUsdcBalanceMicro(a.hedera_account_id);
      accountsChecked += 1;
      if (chain !== ledger) {
        findings.push({
          subject: `user:${a.user_id}`,
          hederaAccountId: a.hedera_account_id,
          ledgerMinor: ledger.toString(),
          chainMinor: chain.toString(),
          driftMinor: (chain - ledger).toString(),
        });
      }
    }

    // Escrow custodian coverage: operator on-chain USDC >= escrow ledger balance.
    if (config.HEDERA_OPERATOR_ID) {
      const escrowAcct = await getSystemAccount("escrow", "USDC");
      const ledger = await getBalance(escrowAcct);
      const chain = await provider.getUsdcBalanceMicro(config.HEDERA_OPERATOR_ID);
      accountsChecked += 1;
      if (chain < ledger) {
        findings.push({
          subject: "escrow_custodian",
          hederaAccountId: config.HEDERA_OPERATOR_ID,
          ledgerMinor: ledger.toString(),
          chainMinor: chain.toString(),
          driftMinor: (chain - ledger).toString(),
        });
      }
    }
  } catch (e) {
    return recordRun("error", accountsChecked, [], {
      error: e instanceof Error ? e.message : "reconciliation failed",
    });
  }

  return recordRun(findings.length > 0 ? "drift" : "ok", accountsChecked, findings, {});
}

/** True when the latest run found drift — on-chain settlement must not proceed. */
export async function isSettlementGated(): Promise<boolean> {
  const latest = await getDb().queryOne<{ result: string }>(
    "SELECT result FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1"
  );
  return latest?.result === "drift";
}

/** Throw RECONCILIATION_HOLD if the latest run found drift (the settlement gate). */
export async function assertSettlementUngated(): Promise<void> {
  if (await isSettlementGated()) {
    throw new AppError(
      ErrorCode.RECONCILIATION_HOLD,
      "On-chain settlement is gated: the last reconciliation run found ledger⇄chain drift"
    );
  }
}

/** Latest run + its findings (the admin read surface). */
export async function getLatestRun(): Promise<ReconciliationRun | null> {
  const db = getDb();
  const run = await db.queryOne<{
    id: string;
    result: ReconciliationRun["result"];
    accounts_checked: number;
    drift_count: number;
    created_at: string;
  }>("SELECT id, result, accounts_checked, drift_count, created_at FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1");
  if (!run) return null;
  const rows = await db.query<{
    subject: string;
    hedera_account_id: string | null;
    ledger_minor: string | number;
    chain_minor: string | number;
    drift_minor: string | number;
  }>(
    "SELECT subject, hedera_account_id, ledger_minor, chain_minor, drift_minor FROM reconciliation_findings WHERE run_id = ?",
    [run.id]
  );
  return {
    id: run.id,
    result: run.result,
    accountsChecked: run.accounts_checked,
    driftCount: run.drift_count,
    createdAt: run.created_at,
    findings: rows.map((r) => ({
      subject: r.subject,
      hederaAccountId: r.hedera_account_id,
      ledgerMinor: BigInt(r.ledger_minor).toString(),
      chainMinor: BigInt(r.chain_minor).toString(),
      driftMinor: BigInt(r.drift_minor).toString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Daily job (started from index.ts when HEDERA_ENABLED).
// ---------------------------------------------------------------------------
let timer: ReturnType<typeof setInterval> | null = null;

export function startReconciliationLoop(intervalMs = 24 * 60 * 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    void runReconciliation().catch(() => {
      /* run errors are recorded as 'error' runs; never crash the loop */
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopReconciliationLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
