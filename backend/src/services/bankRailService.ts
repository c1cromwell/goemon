/**
 * Phase 19 Stage-1 — full-bank rails (fiat on/off-ramp + ACH/wire payouts).
 *
 * The "money app" rails WITHOUT becoming a bank: a partner bank (the FBO that actually
 * holds customer fiat) moves money; we mirror every move into the ledger via the existing
 * `external_clearing` system account (the documented attach seam). Customer balances stay
 * the ledger's user_cash, which is FBO-backed 1:1 at the partner bank.
 *
 *   deposit  (on-ramp):  external_clearing → user_cash
 *   withdraw (off-ramp):  user_cash → external_clearing   (ACH/wire payout)
 *   return   (ACH return): reverses the original journal
 *
 * Every flow is idempotent (bank_transfers.idempotency_key + the settlement journal),
 * append-only at the ledger, integer minor units, and gated by the account-freeze + fraud
 * rails reused from the transfer path. The partner bank is a swappable BankRailProvider
 * (simulated stand-in; column/treasuryprime/unit are the prod swaps), selected by
 * BANK_RAIL_PROVIDER. Off by default behind BANK_RAILS_ENABLED (prod-fatal).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, type Db } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { screenTransfer } from "./fraudService";
import { bankTransferTotal } from "../observability/metrics";
import { getBalance, getOrCreateUserAccount, getSystemAccount, postJournal } from "./ledgerService";

export type BankMethod = "ach" | "wire" | "instant";

export interface BankRailProvider {
  name: string;
  initiateDeposit(input: { userId: string; amountMinor: bigint; currency: string }): Promise<{ externalRef: string; settled: boolean }>;
  initiatePayout(input: { userId: string; amountMinor: bigint; currency: string; method: BankMethod; destination?: string }): Promise<{ externalRef: string; settled: boolean }>;
  /** What the partner bank holds in the FBO for us (the 1:1 backing of customer cash). */
  fboBalance(currency: string): Promise<bigint>;
}

function assertEnabled(): void {
  if (!config.BANK_RAILS_ENABLED) throw new AppError(ErrorCode.BANK_RAILS_DISABLED, "Bank rails are currently unavailable");
}

/** Sum of all customer user_cash for a currency — the liability the FBO must back. */
async function totalUserCash(currency: string): Promise<bigint> {
  const rows = await getDb().query<{ id: string }>(
    "SELECT id FROM ledger_accounts WHERE kind = 'user_cash' AND currency = ? AND user_id IS NOT NULL",
    [currency]
  );
  let sum = 0n;
  for (const r of rows) sum += await getBalance(r.id);
  return sum;
}

// --- Provider seam ----------------------------------------------------------

function simulatedProvider(): BankRailProvider {
  return {
    name: "simulated",
    async initiateDeposit() { return { externalRef: `sim-dep-${uuidv4().slice(0, 8)}`, settled: true }; },
    async initiatePayout() { return { externalRef: `sim-pay-${uuidv4().slice(0, 8)}`, settled: true }; },
    // The stand-in always reports the FBO fully backing customer cash 1:1. A real
    // provider reports the bank's TRUE balance; a shortfall surfaces as coverage drift.
    async fboBalance(currency) { return totalUserCash(currency); },
  };
}

function notImplemented(name: string): BankRailProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, `BANK_RAIL_PROVIDER=${name} is not wired in this prototype — integrate the partner bank (deposits/payouts/FBO balance)`);
  };
  return { name, initiateDeposit: fail, initiatePayout: fail, fboBalance: fail };
}

let provider: BankRailProvider | null = null;
export function setBankRailProvider(p: BankRailProvider | null): void { provider = p; }
export function getBankRailProvider(): BankRailProvider {
  if (provider) return provider;
  switch (config.BANK_RAIL_PROVIDER) {
    case "column": return notImplemented("column");
    case "treasuryprime": return notImplemented("treasuryprime");
    case "unit": return notImplemented("unit");
    default: return simulatedProvider();
  }
}

// --- Money flows ------------------------------------------------------------

export interface BankTransferRow {
  id: string; user_id: string; direction: string; method: string; amount_minor: string;
  currency: string; status: string; counterparty: string | null; external_ref: string | null;
  journal_id: string | null; idempotency_key: string | null; created_at: string; settled_at: string | null;
}

export interface BankTransferResult {
  transferId: string; journalId: string; status: string; externalRef: string;
}

async function existingByKey(key: string): Promise<BankTransferRow | null> {
  return getDb().queryOne<BankTransferRow>("SELECT * FROM bank_transfers WHERE idempotency_key = ?", [key]);
}

function assertAmount(amountMinor: bigint, currency: string): void {
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (currency !== "USD" && currency !== "USDC") throw new AppError(ErrorCode.VALIDATION, "Unsupported currency");
}

/** On-ramp: pull fiat from the partner bank into the user's ledger cash. */
export async function deposit(input: { userId: string; amountMinor: bigint; currency?: string; idempotencyKey: string }): Promise<BankTransferResult> {
  assertEnabled();
  const currency = input.currency ?? "USD";
  assertAmount(input.amountMinor, currency);
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const prior = await existingByKey(input.idempotencyKey);
  if (prior) return { transferId: prior.id, journalId: prior.journal_id ?? "", status: prior.status, externalRef: prior.external_ref ?? "" };

  const ext = await getBankRailProvider().initiateDeposit({ userId: input.userId, amountMinor: input.amountMinor, currency });
  const clearing = await getSystemAccount("external_clearing", currency);
  const cash = await getOrCreateUserAccount(input.userId, "user_cash", currency);
  const journalId = await postJournal(
    [
      { ledgerAccountId: clearing, direction: "debit", amountMinor: input.amountMinor, currency },
      { ledgerAccountId: cash, direction: "credit", amountMinor: input.amountMinor, currency },
    ],
    `Bank deposit (${ext.externalRef})`,
    { idempotencyKey: `bank:dep:${input.idempotencyKey}`, externalRef: ext.externalRef }
  );

  const id = await record({ userId: input.userId, direction: "in", method: "ach", amountMinor: input.amountMinor, currency,
    status: ext.settled ? "settled" : "requested", externalRef: ext.externalRef, journalId, idempotencyKey: input.idempotencyKey,
    txType: "deposit", toAccountId: cash, description: "Bank deposit" });

  bankTransferTotal.inc({ direction: "in", result: ext.settled ? "settled" : "requested" });
  await logAudit({ userId: input.userId, action: "bank.deposit", resource: id, details: { amountMinor: input.amountMinor.toString(), currency } });
  return { transferId: id, journalId, status: ext.settled ? "settled" : "requested", externalRef: ext.externalRef };
}

/** Off-ramp: send a user's ledger cash out via ACH/wire to an external account. */
export async function withdraw(input: { userId: string; amountMinor: bigint; currency?: string; method?: BankMethod; destination?: string; idempotencyKey: string; channel?: string }): Promise<BankTransferResult> {
  assertEnabled();
  const currency = input.currency ?? "USD";
  const method = input.method ?? "ach";
  assertAmount(input.amountMinor, currency);
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const prior = await existingByKey(input.idempotencyKey);
  if (prior) return { transferId: prior.id, journalId: prior.journal_id ?? "", status: prior.status, externalRef: prior.external_ref ?? "" };

  const cash = await getOrCreateUserAccount(input.userId, "user_cash", currency);
  const clearing = await getSystemAccount("external_clearing", currency);

  // Money leaving the platform — screen it (degrades open; the balance check below is authoritative).
  await screenTransfer({
    eventType: "bank.withdraw", channel: input.channel ?? "bank", userId: input.userId,
    counterpartyId: input.destination ?? "external", fromAccountId: cash, toAccountId: clearing,
    amountMinor: input.amountMinor, currency, idempotencyKey: input.idempotencyKey,
  });

  return getDb().transaction(async (tx) => {
    const balance = await getBalance(cash, tx);
    if (balance < input.amountMinor) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");

    const ext = await getBankRailProvider().initiatePayout({ userId: input.userId, amountMinor: input.amountMinor, currency, method, destination: input.destination });
    const journalId = await postJournal(
      [
        { ledgerAccountId: cash, direction: "debit", amountMinor: input.amountMinor, currency },
        { ledgerAccountId: clearing, direction: "credit", amountMinor: input.amountMinor, currency },
      ],
      `Bank ${method} payout (${ext.externalRef})`,
      { idempotencyKey: `bank:wd:${input.idempotencyKey}`, externalRef: ext.externalRef, db: tx }
    );

    const id = await record({ userId: input.userId, direction: "out", method, amountMinor: input.amountMinor, currency,
      status: ext.settled ? "settled" : "requested", externalRef: ext.externalRef, journalId, idempotencyKey: input.idempotencyKey,
      txType: "withdrawal", fromAccountId: cash, toExternal: input.destination ?? "external", description: `Bank ${method} payout`, db: tx });

    bankTransferTotal.inc({ direction: "out", result: ext.settled ? "settled" : "requested" });
    await logAudit({ userId: input.userId, action: "bank.withdraw", resource: id, details: { amountMinor: input.amountMinor.toString(), currency, method } });
    return { transferId: id, journalId, status: ext.settled ? "settled" : "requested", externalRef: ext.externalRef };
  });
}

/** ACH return / failed payout — reverse a settled transfer (idempotent). */
export async function returnTransfer(transferId: string): Promise<{ reversed: boolean }> {
  assertEnabled();
  const db = getDb();
  const t = await db.queryOne<BankTransferRow>("SELECT * FROM bank_transfers WHERE id = ?", [transferId]);
  if (!t) throw new AppError(ErrorCode.NOT_FOUND, "Bank transfer not found");
  if (t.status === "returned") return { reversed: false };
  if (t.status !== "settled") throw new AppError(ErrorCode.CONFLICT, "Only settled transfers can be returned");

  const amount = BigInt(t.amount_minor);
  const cash = await getOrCreateUserAccount(t.user_id, "user_cash", t.currency);
  const clearing = await getSystemAccount("external_clearing", t.currency);
  // Reverse the original direction: a returned deposit claws cash back; a returned payout restores it.
  const entries = t.direction === "in"
    ? [{ ledgerAccountId: cash, direction: "debit" as const, amountMinor: amount, currency: t.currency }, { ledgerAccountId: clearing, direction: "credit" as const, amountMinor: amount, currency: t.currency }]
    : [{ ledgerAccountId: clearing, direction: "debit" as const, amountMinor: amount, currency: t.currency }, { ledgerAccountId: cash, direction: "credit" as const, amountMinor: amount, currency: t.currency }];

  await postJournal(entries, `Bank ${t.direction === "in" ? "deposit" : "payout"} return (${t.id})`, { idempotencyKey: `bank:return:${t.id}` });
  await db.execute("UPDATE bank_transfers SET status = 'returned', settled_at = ? WHERE id = ?", [new Date().toISOString(), t.id]);
  bankTransferTotal.inc({ direction: t.direction, result: "returned" });
  await logAudit({ userId: t.user_id, action: "bank.transfer.returned", resource: t.id, details: { direction: t.direction } });
  return { reversed: true };
}

/** FBO coverage: the partner bank's FBO must fully back total customer cash (1:1). */
export async function fboCoverage(currency = "USD"): Promise<{ liabilityMinor: bigint; fboBalanceMinor: bigint; covered: boolean }> {
  const liabilityMinor = await totalUserCash(currency);
  const provider = getBankRailProvider();
  // Simulated provider derives FBO from the same ledger query — reuse the snapshot
  // so concurrent user creation in the test suite cannot race two summations apart.
  const fboBalanceMinor = provider.name === "simulated" ? liabilityMinor : await provider.fboBalance(currency);
  return { liabilityMinor, fboBalanceMinor, covered: fboBalanceMinor >= liabilityMinor };
}

export async function listTransfers(userId: string, limit = 50): Promise<BankTransferRow[]> {
  return getDb().query<BankTransferRow>("SELECT * FROM bank_transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, Math.min(Math.max(limit, 1), 200)]);
}

// --- Linked external bank accounts (payout destinations) --------------------

export interface BankAccountRow {
  id: string; user_id: string; label: string | null; type: string; masked_number: string; routing: string | null; status: string; created_at: string;
}

/** Link an external bank account. Only a masked number (last4) is ever stored. */
export async function linkBankAccount(input: { userId: string; label?: string; type?: string; last4: string; routing?: string }): Promise<BankAccountRow> {
  assertEnabled();
  if (!/^\d{4}$/.test(input.last4)) throw new AppError(ErrorCode.VALIDATION, "last4 must be 4 digits");
  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO bank_accounts (id, user_id, label, type, masked_number, routing, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    [id, input.userId, input.label ?? null, input.type ?? "checking", `••••${input.last4}`, input.routing ?? null, new Date().toISOString()]
  );
  return (await getDb().queryOne<BankAccountRow>("SELECT * FROM bank_accounts WHERE id = ?", [id]))!;
}

export async function listBankAccounts(userId: string): Promise<BankAccountRow[]> {
  return getDb().query<BankAccountRow>("SELECT * FROM bank_accounts WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC", [userId]);
}

// --- internal ---------------------------------------------------------------

async function record(r: {
  userId: string; direction: "in" | "out"; method: BankMethod; amountMinor: bigint; currency: string; status: string;
  externalRef: string; journalId: string; idempotencyKey: string; txType: string; fromAccountId?: string; toAccountId?: string;
  toExternal?: string; description: string; db?: Db;
}): Promise<string> {
  const exec = r.db ?? getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  await exec.execute(
    `INSERT INTO bank_transfers (id, user_id, direction, method, amount_minor, currency, status, counterparty, external_ref, journal_id, idempotency_key, created_at, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, r.userId, r.direction, r.method, r.amountMinor.toString(), r.currency, r.status, r.toExternal ?? null, r.externalRef, r.journalId, r.idempotencyKey, now, r.status === "settled" ? now : null]
  );
  await exec.execute(
    `INSERT INTO transactions (id, user_id, journal_id, from_account_id, to_account_id, to_external, amount_minor, currency, description, type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    [uuidv4(), r.userId, r.journalId, r.fromAccountId ?? null, r.toAccountId ?? null, r.toExternal ?? null, r.amountMinor.toString(), r.currency, r.description, r.txType, now]
  );
  return id;
}
