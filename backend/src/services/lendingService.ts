/**
 * Collateralized lending (prototype; PRD v2) — "borrow against your holdings without
 * selling." A user pledges a tokenized position (valued at par — the Treasury ATB is the
 * v1 collateral) and borrows USD against it, keeping the asset to reclaim on repayment.
 *
 * Over-collateralized, no credit check (the collateral IS the underwriting):
 *   - open:  borrow ≤ MAX_LTV × collateralValue; lock asset → loan_collateral, disburse
 *            lending_pool(USD) → user_cash(USD), idempotent balanced journal.
 *   - accrue: simple interest on the outstanding principal (APR × elapsed/365), advanced
 *            on a stored cursor (explicit, like treasuryService.accrueYield).
 *   - repay: interest first then principal (user_cash → fee + lending_pool); on full
 *            repayment the collateral is released back to the user's holding.
 *   - liquidate: if outstanding breaches LIQUIDATION_LTV × collateralValue, seize the
 *            collateral, cover the debt from the simulated sale proceeds, return any
 *            surplus to the user.
 *
 * Maximum reuse of the ledger primitives: collateral and cash are ordinary ledger
 * accounts; every move is balanced + idempotent + append-only. Off by default behind
 * LENDING_ENABLED (prod-fatal). Real lending needs a lender of record + licensing + a
 * real liquidity source — out of scope for the prototype.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { lendingLoanTotal } from "../observability/metrics";
import {
  assetLedgerCode,
  getBalance,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  getOrCreateUserAssetAccount,
  postJournal,
  type LedgerEntryInput,
} from "./ledgerService";
import { requireAsset } from "./tokenizationService";

const BORROW_CURRENCY = "USD";

function assertEnabled(): void {
  if (!config.LENDING_ENABLED) throw new AppError(ErrorCode.LENDING_DISABLED, "Lending is currently unavailable");
}

/**
 * Value a pledged collateral position in the borrow currency (minor units). v1 prices a
 * tokenized holding at its par value from the asset metadata (`parMinor` — the Treasury
 * ATB carries it). Assets without a par price are not eligible as collateral in the
 * prototype (a real product would use the marketplace pricing service).
 */
async function valueCollateral(assetId: string, qtyBase: bigint): Promise<bigint> {
  const asset = await requireAsset(assetId);
  const parRaw = asset.metadata?.parMinor;
  const parMinor = typeof parRaw === "string" || typeof parRaw === "number" ? BigInt(parRaw) : null;
  if (!parMinor || parMinor <= 0n) {
    throw new AppError(ErrorCode.VALIDATION, "Asset is not eligible as collateral (no par price)");
  }
  // Ledger holdings are denominated in whole tokens (matching treasuryService.positions:
  // valueMinor = qty × parMinor); parMinor is the per-token value in the borrow currency.
  return qtyBase * parMinor;
}

interface LoanRow {
  id: string; user_id: string; collateral_asset_id: string; collateral_qty_base: string;
  borrow_currency: string; principal_minor: string; principal_outstanding_minor: string;
  accrued_interest_minor: string; apr_bps: number; max_ltv_bps: number; liquidation_ltv_bps: number;
  status: string; open_journal_id: string | null; accrued_through: string; opened_at: string;
  closed_at: string | null; idempotency_key: string | null;
}

export interface Loan {
  id: string; userId: string; collateralAssetId: string; collateralQtyBase: string;
  borrowCurrency: string; principalMinor: string; principalOutstandingMinor: string;
  accruedInterestMinor: string; outstandingMinor: string; collateralValueMinor: string;
  healthFactorBps: number; aprBps: number; maxLtvBps: number; liquidationLtvBps: number;
  status: string; openedAt: string; closedAt: string | null;
}

async function toLoan(r: LoanRow): Promise<Loan> {
  const outstanding = BigInt(r.principal_outstanding_minor) + BigInt(r.accrued_interest_minor);
  const collateralValue = await valueCollateral(r.collateral_asset_id, BigInt(r.collateral_qty_base));
  // health = (collateralValue × liquidationLTV) / outstanding, as bps. ≤10000 ⇒ liquidatable.
  const healthFactorBps = outstanding > 0n
    ? Number((collateralValue * BigInt(r.liquidation_ltv_bps)) / outstanding)
    : Number.MAX_SAFE_INTEGER;
  return {
    id: r.id, userId: r.user_id, collateralAssetId: r.collateral_asset_id, collateralQtyBase: r.collateral_qty_base,
    borrowCurrency: r.borrow_currency, principalMinor: r.principal_minor, principalOutstandingMinor: r.principal_outstanding_minor,
    accruedInterestMinor: r.accrued_interest_minor, outstandingMinor: outstanding.toString(), collateralValueMinor: collateralValue.toString(),
    healthFactorBps, aprBps: r.apr_bps, maxLtvBps: r.max_ltv_bps, liquidationLtvBps: r.liquidation_ltv_bps,
    status: r.status, openedAt: r.opened_at, closedAt: r.closed_at,
  };
}

async function rowById(loanId: string): Promise<LoanRow> {
  const row = await getDb().queryOne<LoanRow>("SELECT * FROM loans WHERE id = ?", [loanId]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Loan not found");
  return row;
}

/** Open a loan: pledge collateral and disburse the borrowed USD. Idempotent. */
export async function openLoan(input: {
  userId: string; collateralAssetId: string; collateralQtyBase: bigint; borrowMinor: bigint; idempotencyKey: string;
}): Promise<Loan> {
  assertEnabled();
  if (input.collateralQtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "collateralQtyBase must be positive");
  if (input.borrowMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "borrowMinor must be positive");
  if (await isAccountFrozen(input.userId)) throw new AppError(ErrorCode.ACCOUNT_FROZEN, "Account is frozen pending review");

  const prior = await getDb().queryOne<LoanRow>("SELECT * FROM loans WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return toLoan(prior);

  const collateralValue = await valueCollateral(input.collateralAssetId, input.collateralQtyBase);
  const maxBorrow = (collateralValue * BigInt(config.LENDING_MAX_LTV_BPS)) / 10_000n;
  if (input.borrowMinor > maxBorrow) {
    throw new AppError(ErrorCode.LTV_EXCEEDED, `Borrow exceeds the max LTV (${config.LENDING_MAX_LTV_BPS / 100}% → up to ${maxBorrow} minor units)`);
  }

  const code = assetLedgerCode(input.collateralAssetId);
  const holding = await getOrCreateUserAssetAccount(input.userId, input.collateralAssetId);
  if ((await getBalance(holding)) < input.collateralQtyBase) {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient collateral holding");
  }
  const collateralAcct = await getOrCreateSystemAccount("loan_collateral", code);
  const pool = await getOrCreateSystemAccount("lending_pool", BORROW_CURRENCY);
  const cash = await getOrCreateUserAccount(input.userId, "user_cash", BORROW_CURRENCY);

  const journalId = await postJournal(
    [
      // Lock the collateral (asset leg nets to zero).
      { ledgerAccountId: holding, direction: "debit", amountMinor: input.collateralQtyBase, currency: code },
      { ledgerAccountId: collateralAcct, direction: "credit", amountMinor: input.collateralQtyBase, currency: code },
      // Disburse the loan (cash leg nets to zero).
      { ledgerAccountId: pool, direction: "debit", amountMinor: input.borrowMinor, currency: BORROW_CURRENCY },
      { ledgerAccountId: cash, direction: "credit", amountMinor: input.borrowMinor, currency: BORROW_CURRENCY },
    ],
    "Loan open",
    { idempotencyKey: `loan:open:${input.idempotencyKey}` }
  );

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO loans (id, user_id, collateral_asset_id, collateral_qty_base, borrow_currency, principal_minor, principal_outstanding_minor, accrued_interest_minor, apr_bps, max_ltv_bps, liquidation_ltv_bps, status, open_journal_id, accrued_through, opened_at, closed_at, idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.userId, input.collateralAssetId, input.collateralQtyBase.toString(), BORROW_CURRENCY, input.borrowMinor.toString(), input.borrowMinor.toString(),
     "0", config.LENDING_APR_BPS, config.LENDING_MAX_LTV_BPS, config.LENDING_LIQUIDATION_LTV_BPS, "active", journalId, now, now, null, input.idempotencyKey]
  );

  lendingLoanTotal.inc({ result: "opened" });
  await logAudit({ userId: input.userId, action: "lending.open", resource: id, details: { borrowMinor: input.borrowMinor.toString(), collateralValueMinor: collateralValue.toString(), assetId: input.collateralAssetId } });
  return toLoan(await rowById(id));
}

/** Advance interest accrual on the outstanding principal. Explicit (daily loop / admin). */
export async function accrueInterest(loanId: string, opts?: { periodDays?: number; asOf?: Date }): Promise<Loan> {
  assertEnabled();
  const row = await rowById(loanId);
  if (row.status !== "active") return toLoan(row);

  const asOf = opts?.asOf ?? new Date();
  const through = new Date(row.accrued_through);
  const elapsedMs = asOf.getTime() - through.getTime();
  const days = opts?.periodDays ?? Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return toLoan(row);

  const principal = BigInt(row.principal_outstanding_minor);
  // interest = principal × apr(bps)/10000 × days/365, integer-floored to minor units.
  const interest = (principal * BigInt(row.apr_bps) * BigInt(Math.floor(days * 1_000_000))) / (10_000n * 365n * 1_000_000n);
  const newAccrued = BigInt(row.accrued_interest_minor) + interest;
  await getDb().execute("UPDATE loans SET accrued_interest_minor = ?, accrued_through = ? WHERE id = ?", [newAccrued.toString(), asOf.toISOString(), loanId]);
  return toLoan(await rowById(loanId));
}

/** Repay (interest first, then principal). On full repayment, release the collateral. */
export async function repay(input: { userId: string; loanId: string; amountMinor: bigint; idempotencyKey: string }): Promise<Loan> {
  assertEnabled();
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMinor must be positive");
  const row = await rowById(input.loanId);
  if (row.user_id !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your loan");
  if (row.status !== "active") throw new AppError(ErrorCode.CONFLICT, "Loan is not active");

  const prior = await getDb().queryOne<{ id: string }>("SELECT id FROM ledger_journals WHERE idempotency_key = ?", [`loan:repay:${input.idempotencyKey}`]);
  if (prior) return toLoan(row);

  const accrued = BigInt(row.accrued_interest_minor);
  const principalOut = BigInt(row.principal_outstanding_minor);
  const outstanding = accrued + principalOut;
  const pay = input.amountMinor > outstanding ? outstanding : input.amountMinor;
  const interestPaid = pay > accrued ? accrued : pay;
  const principalPaid = pay - interestPaid;

  const cash = await getOrCreateUserAccount(input.userId, "user_cash", BORROW_CURRENCY);
  if ((await getBalance(cash)) < pay) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient USD balance to repay");
  const pool = await getOrCreateSystemAccount("lending_pool", BORROW_CURRENCY);

  const entries: LedgerEntryInput[] = [{ ledgerAccountId: cash, direction: "debit", amountMinor: pay, currency: BORROW_CURRENCY }];
  if (principalPaid > 0n) entries.push({ ledgerAccountId: pool, direction: "credit", amountMinor: principalPaid, currency: BORROW_CURRENCY });
  if (interestPaid > 0n) {
    const fee = await getOrCreateSystemAccount("fee", BORROW_CURRENCY);
    entries.push({ ledgerAccountId: fee, direction: "credit", amountMinor: interestPaid, currency: BORROW_CURRENCY });
  }
  await postJournal(entries, "Loan repayment", { idempotencyKey: `loan:repay:${input.idempotencyKey}` });

  const newPrincipal = principalOut - principalPaid;
  const newAccrued = accrued - interestPaid;
  const fullyRepaid = newPrincipal === 0n && newAccrued === 0n;

  if (fullyRepaid) {
    // Release the collateral back to the user's holding.
    const code = assetLedgerCode(row.collateral_asset_id);
    const collateralAcct = await getOrCreateSystemAccount("loan_collateral", code);
    const holding = await getOrCreateUserAssetAccount(input.userId, row.collateral_asset_id);
    await postJournal(
      [
        { ledgerAccountId: collateralAcct, direction: "debit", amountMinor: BigInt(row.collateral_qty_base), currency: code },
        { ledgerAccountId: holding, direction: "credit", amountMinor: BigInt(row.collateral_qty_base), currency: code },
      ],
      "Loan collateral release",
      { idempotencyKey: `loan:release:${row.id}` }
    );
    await getDb().execute("UPDATE loans SET principal_outstanding_minor = '0', accrued_interest_minor = '0', status = 'repaid', closed_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
    lendingLoanTotal.inc({ result: "repaid" });
  } else {
    await getDb().execute("UPDATE loans SET principal_outstanding_minor = ?, accrued_interest_minor = ? WHERE id = ?", [newPrincipal.toString(), newAccrued.toString(), row.id]);
  }

  await logAudit({ userId: input.userId, action: "lending.repay", resource: row.id, details: { paidMinor: pay.toString(), interestPaidMinor: interestPaid.toString(), fullyRepaid } });
  return toLoan(await rowById(row.id));
}

/**
 * Liquidate an under-water loan: if the outstanding debt breaches LIQUIDATION_LTV of the
 * collateral value, seize the collateral (simulated sale) to cover the debt and return
 * any surplus to the user. Idempotent on the seizure journal.
 */
export async function liquidate(loanId: string): Promise<{ loan: Loan; liquidated: boolean }> {
  assertEnabled();
  const row = await rowById(loanId);
  if (row.status !== "active") return { loan: await toLoan(row), liquidated: false };

  const accrued = BigInt(row.accrued_interest_minor);
  const principalOut = BigInt(row.principal_outstanding_minor);
  const outstanding = accrued + principalOut;
  const collateralValue = await valueCollateral(row.collateral_asset_id, BigInt(row.collateral_qty_base));
  const liquidationCeiling = (collateralValue * BigInt(row.liquidation_ltv_bps)) / 10_000n;
  if (outstanding <= liquidationCeiling) {
    return { loan: await toLoan(row), liquidated: false }; // still healthy
  }

  const code = assetLedgerCode(row.collateral_asset_id);
  const collateralAcct = await getOrCreateSystemAccount("loan_collateral", code);
  const liqAssetSink = await getOrCreateSystemAccount("liquidation_sink", code);
  const liqSettlement = await getOrCreateSystemAccount("liquidation_settlement", BORROW_CURRENCY);
  const pool = await getOrCreateSystemAccount("lending_pool", BORROW_CURRENCY);
  const fee = await getOrCreateSystemAccount("fee", BORROW_CURRENCY);
  const cash = await getOrCreateUserAccount(row.user_id, "user_cash", BORROW_CURRENCY);

  // Sale proceeds = collateral value. Cover interest then principal; any surplus to the user.
  const covered = outstanding > collateralValue ? collateralValue : outstanding;
  const interestCovered = covered > accrued ? accrued : covered;
  const principalCovered = covered - interestCovered;
  const surplus = collateralValue - covered;

  // 1) Seize the collateral asset (asset leg nets to zero).
  await postJournal(
    [
      { ledgerAccountId: collateralAcct, direction: "debit", amountMinor: BigInt(row.collateral_qty_base), currency: code },
      { ledgerAccountId: liqAssetSink, direction: "credit", amountMinor: BigInt(row.collateral_qty_base), currency: code },
    ],
    "Loan liquidation — collateral seizure",
    { idempotencyKey: `loan:liq:asset:${row.id}` }
  );

  // 2) Settle the simulated sale proceeds (cash leg nets to zero).
  const cashEntries: LedgerEntryInput[] = [{ ledgerAccountId: liqSettlement, direction: "debit", amountMinor: collateralValue, currency: BORROW_CURRENCY }];
  if (principalCovered > 0n) cashEntries.push({ ledgerAccountId: pool, direction: "credit", amountMinor: principalCovered, currency: BORROW_CURRENCY });
  if (interestCovered > 0n) cashEntries.push({ ledgerAccountId: fee, direction: "credit", amountMinor: interestCovered, currency: BORROW_CURRENCY });
  if (surplus > 0n) cashEntries.push({ ledgerAccountId: cash, direction: "credit", amountMinor: surplus, currency: BORROW_CURRENCY });
  await postJournal(cashEntries, "Loan liquidation — settlement", { idempotencyKey: `loan:liq:cash:${row.id}` });

  await getDb().execute("UPDATE loans SET principal_outstanding_minor = '0', accrued_interest_minor = '0', status = 'liquidated', closed_at = ? WHERE id = ?", [new Date().toISOString(), row.id]);
  lendingLoanTotal.inc({ result: "liquidated" });
  await logAudit({ userId: row.user_id, action: "lending.liquidate", resource: row.id, details: { collateralValueMinor: collateralValue.toString(), coveredMinor: covered.toString(), surplusMinor: surplus.toString() } });
  return { loan: await toLoan(await rowById(row.id)), liquidated: true };
}

export async function getLoan(userId: string, loanId: string): Promise<Loan> {
  const row = await rowById(loanId);
  if (row.user_id !== userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your loan");
  return toLoan(row);
}

export async function listLoans(userId: string): Promise<Loan[]> {
  const rows = await getDb().query<LoanRow>("SELECT * FROM loans WHERE user_id = ? ORDER BY opened_at DESC LIMIT 100", [userId]);
  return Promise.all(rows.map(toLoan));
}

/** The current max additional borrow for a candidate collateral pledge (a quote). */
export async function borrowingPower(assetId: string, qtyBase: bigint): Promise<{ collateralValueMinor: string; maxBorrowMinor: string; aprBps: number; maxLtvBps: number }> {
  assertEnabled();
  const collateralValue = await valueCollateral(assetId, qtyBase);
  const maxBorrow = (collateralValue * BigInt(config.LENDING_MAX_LTV_BPS)) / 10_000n;
  return { collateralValueMinor: collateralValue.toString(), maxBorrowMinor: maxBorrow.toString(), aprBps: config.LENDING_APR_BPS, maxLtvBps: config.LENDING_MAX_LTV_BPS };
}
