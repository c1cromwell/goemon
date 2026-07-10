/**
 * Tokenized-deposit READINESS seam (see docs/business/SWIFT-SHARED-LEDGER-ASSESSMENT.md).
 *
 * A tokenized deposit is a chartered bank's insured, yield-bearing liability represented
 * on-chain. Goemon is NOT the issuer — a partner bank is. This seam lets Goemon custody and
 * MIRROR such a token the way hederaService mirrors USDC: value moves on the existing
 * `external_clearing` attach seam as balanced per-currency journals in the `USDD` currency
 * (kind: tokenized_deposit). The one thing a tokenized deposit has that USDC does not —
 * yield — is modeled by `accrueInterest` (the "insured, yield-bearing on-chain dollars"
 * product angle). No on-chain issuance, no FDIC reality; off by default behind
 * TOKENIZED_DEPOSITS_ENABLED (prod-fatal — no partner issuer is wired).
 */

import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { assertSupported } from "./currencyRegistry";
import {
  getBalance,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  postJournal,
} from "./ledgerService";

/** The demo partner-bank deposit-token currency (registry code). */
const DEPOSIT_CURRENCY = "USDD";

function assertEnabled(): void {
  if (!config.TOKENIZED_DEPOSITS_ENABLED) {
    throw new AppError(ErrorCode.TOKENIZED_DEPOSITS_DISABLED, "Tokenized deposits are currently unavailable");
  }
  assertSupported(DEPOSIT_CURRENCY); // registry must have it enabled
}

export interface DepositResult {
  journalId: string;
  amountMinor: string;
  currency: string;
}

/**
 * Mirror a partner-bank-issued tokenized deposit INTO the ledger (the bank minted it to the
 * user; we reflect the custody). external_clearing(USDD) → user_cash(USDD). Idempotent.
 */
export async function issue(input: { userId: string; amountMinor: bigint; idempotencyKey: string }): Promise<DepositResult> {
  assertEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const key = `tokdep:issue:${input.idempotencyKey}`;
  const prior = await getDb().queryOne<{ id: string }>("SELECT id FROM ledger_journals WHERE idempotency_key = ?", [key]);
  if (prior) return { journalId: prior.id, amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY };

  const clearing = await getOrCreateSystemAccount("external_clearing", DEPOSIT_CURRENCY);
  const cash = await getOrCreateUserAccount(input.userId, "user_cash", DEPOSIT_CURRENCY);
  const journalId = await postJournal(
    [
      { ledgerAccountId: clearing, direction: "debit", amountMinor: input.amountMinor, currency: DEPOSIT_CURRENCY },
      { ledgerAccountId: cash, direction: "credit", amountMinor: input.amountMinor, currency: DEPOSIT_CURRENCY },
    ],
    "Tokenized deposit issue (partner-bank mint mirror)",
    { idempotencyKey: key }
  );

  await logAudit({ userId: input.userId, action: "tokdep.issue", resource: journalId, details: { amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY } });
  return { journalId, amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY };
}

/**
 * Redeem the tokenized deposit back to the partner bank. user_cash(USDD) → external_clearing(USDD).
 * Balance-checked inside the debit transaction (no TOCTOU). Idempotent.
 */
export async function redeem(input: { userId: string; amountMinor: bigint; idempotencyKey: string }): Promise<DepositResult> {
  assertEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const key = `tokdep:redeem:${input.idempotencyKey}`;
  const prior = await getDb().queryOne<{ id: string }>("SELECT id FROM ledger_journals WHERE idempotency_key = ?", [key]);
  if (prior) return { journalId: prior.id, amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY };

  return getDb().transaction(async (tx) => {
    const cash = await getOrCreateUserAccount(input.userId, "user_cash", DEPOSIT_CURRENCY);
    const clearing = await getOrCreateSystemAccount("external_clearing", DEPOSIT_CURRENCY);
    if ((await getBalance(cash, tx)) < input.amountMinor) {
      throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient tokenized-deposit balance");
    }
    const journalId = await postJournal(
      [
        { ledgerAccountId: cash, direction: "debit", amountMinor: input.amountMinor, currency: DEPOSIT_CURRENCY },
        { ledgerAccountId: clearing, direction: "credit", amountMinor: input.amountMinor, currency: DEPOSIT_CURRENCY },
      ],
      "Tokenized deposit redemption",
      { idempotencyKey: key, db: tx }
    );
    await logAudit({ userId: input.userId, action: "tokdep.redeem", resource: journalId, details: { amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY } });
    return { journalId, amountMinor: input.amountMinor.toString(), currency: DEPOSIT_CURRENCY };
  });
}

/**
 * Accrue yield to a holder — the differentiator over a (non-interest-bearing) stablecoin.
 * interest = balance × APY(bps)/10000 × days/365, integer-floored. interest_source(USDD) →
 * user_cash(USDD). Explicit period (admin/ops-driven), mirroring lendingService.accrueInterest.
 */
export async function accrueInterest(input: { userId: string; periodDays: number }): Promise<{ interestMinor: string; currency: string }> {
  assertEnabled();
  if (input.periodDays <= 0) throw new AppError(ErrorCode.VALIDATION, "periodDays must be positive");

  const cash = await getOrCreateUserAccount(input.userId, "user_cash", DEPOSIT_CURRENCY);
  const balance = await getBalance(cash);
  const days = BigInt(Math.floor(input.periodDays * 1_000_000));
  const interest = (balance * BigInt(config.TOKENIZED_DEPOSIT_APY_BPS) * days) / (10_000n * 365n * 1_000_000n);
  if (interest <= 0n) return { interestMinor: "0", currency: DEPOSIT_CURRENCY };

  const source = await getOrCreateSystemAccount("interest_source", DEPOSIT_CURRENCY);
  await postJournal(
    [
      { ledgerAccountId: source, direction: "debit", amountMinor: interest, currency: DEPOSIT_CURRENCY },
      { ledgerAccountId: cash, direction: "credit", amountMinor: interest, currency: DEPOSIT_CURRENCY },
    ],
    "Tokenized deposit yield accrual"
  );
  await logAudit({ userId: input.userId, action: "tokdep.accrue", resource: input.userId, details: { interestMinor: interest.toString(), periodDays: input.periodDays, aprBps: config.TOKENIZED_DEPOSIT_APY_BPS } });
  return { interestMinor: interest.toString(), currency: DEPOSIT_CURRENCY };
}

/** The user's current tokenized-deposit position (balance + the yield rate). */
export async function getPosition(userId: string): Promise<{ balanceMinor: string; currency: string; apyBps: number }> {
  assertEnabled();
  const cash = await getOrCreateUserAccount(userId, "user_cash", DEPOSIT_CURRENCY);
  return { balanceMinor: (await getBalance(cash)).toString(), currency: DEPOSIT_CURRENCY, apyBps: config.TOKENIZED_DEPOSIT_APY_BPS };
}
