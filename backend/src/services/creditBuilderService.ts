/**
 * Phase 22.4 — credit-builder (secured/charge) card seam for teens.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { assertGuardianOfTeen } from "./householdService";
import { issueCard, type CardAuthRow, type CardRow } from "./cardService";
import { getCreditBureauReporter } from "./creditBureauReporterService";
import { getOrCreateUserAccount, getBalance, postJournal, getSystemAccount } from "./ledgerService";
import { creditBuilderTotal } from "../observability/metrics";

export interface CreditBuilderAccountRow {
  id: string;
  teen_user_id: string;
  guardian_user_id: string;
  card_id: string | null;
  secured_limit_minor: string;
  statement_balance_minor: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreditBuilderStatementRow {
  id: string;
  account_id: string;
  period: string;
  opening_minor: string;
  charges_minor: string;
  payments_minor: string;
  closing_minor: string;
  paid_on_time: number;
  utilization_bps: number;
  bureau_report_id: string | null;
  status: string;
  created_at: string;
}

function assertCreditBuilderEnabled(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Argus Starter is currently unavailable");
  if (!config.TEEN_CREDIT_BUILDER_ENABLED) {
    throw new AppError(ErrorCode.TEEN_CREDIT_BUILDER_DISABLED, "Credit-builder cards are currently unavailable");
  }
}

export async function openCreditBuilderAccount(input: {
  guardianUserId: string;
  teenUserId: string;
  securedLimitMinor: bigint;
}): Promise<CreditBuilderAccountRow> {
  assertCreditBuilderEnabled();
  await assertGuardianOfTeen(input.guardianUserId, input.teenUserId);
  if (input.securedLimitMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Secured limit must be positive");
  if (!config.CARDS_ENABLED) throw new AppError(ErrorCode.CARDS_DISABLED, "Cards are currently unavailable");

  const existing = await getDb().queryOne<CreditBuilderAccountRow>(
    "SELECT * FROM credit_builder_accounts WHERE teen_user_id = ?",
    [input.teenUserId]
  );
  if (existing) return existing;

  const guardianCash = await getOrCreateUserAccount(input.guardianUserId, "user_cash", "USD");
  if ((await getBalance(guardianCash)) < input.securedLimitMinor) {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient guardian funds for secured limit");
  }

  const card = await issueCard(input.teenUserId);
  await getDb().execute(
    "UPDATE cards SET card_type = 'credit_builder', guardian_user_id = ? WHERE id = ?",
    [input.guardianUserId, card.id]
  );

  const securedHold = await getOrCreateUserAccount(input.guardianUserId, "user_savings", "USD");
  await postJournal(
    [
      { ledgerAccountId: guardianCash, direction: "debit", amountMinor: input.securedLimitMinor, currency: "USD" },
      { ledgerAccountId: securedHold, direction: "credit", amountMinor: input.securedLimitMinor, currency: "USD" },
    ],
    `Credit-builder secured limit for teen ${input.teenUserId}`,
    { idempotencyKey: `cb:open:${input.teenUserId}` }
  );

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO credit_builder_accounts
       (id, teen_user_id, guardian_user_id, card_id, secured_limit_minor, statement_balance_minor, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '0', 'active', ?, ?)`,
    [id, input.teenUserId, input.guardianUserId, card.id, input.securedLimitMinor.toString(), now, now]
  );

  creditBuilderTotal.inc({ action: "opened" });
  await logAudit({
    userId: input.guardianUserId,
    action: "starter.credit_builder.open",
    resource: id,
    details: { teenUserId: input.teenUserId, securedLimitMinor: input.securedLimitMinor.toString() },
  });
  return (await getDb().queryOne<CreditBuilderAccountRow>("SELECT * FROM credit_builder_accounts WHERE id = ?", [id]))!;
}

export async function authorizeCreditBuilder(input: {
  userId: string;
  card: CardRow;
  amountMinor: bigint;
  merchant?: string;
  idempotencyKey: string;
}): Promise<CardAuthRow> {
  assertCreditBuilderEnabled();
  const account = await getDb().queryOne<CreditBuilderAccountRow>(
    "SELECT * FROM credit_builder_accounts WHERE teen_user_id = ? AND card_id = ?",
    [input.userId, input.card.id]
  );
  if (!account) throw new AppError(ErrorCode.NOT_FOUND, "Credit-builder account not found");

  const prior = await getDb().queryOne<CardAuthRow>("SELECT * FROM card_authorizations WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return prior;

  const balance = BigInt(account.statement_balance_minor);
  const limit = BigInt(account.secured_limit_minor);
  if (balance + input.amountMinor > limit) {
    throw new AppError(ErrorCode.SPEND_LIMIT_EXCEEDED, "Credit-builder secured limit exceeded");
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO card_authorizations (id, card_id, user_id, merchant, amount_minor, currency, status, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'authorized', ?, ?)`,
      [id, input.card.id, input.userId, input.merchant ?? null, input.amountMinor.toString(), input.card.currency, input.idempotencyKey, now]
    );
    await tx.execute(
      "UPDATE credit_builder_accounts SET statement_balance_minor = ?, updated_at = ? WHERE id = ?",
      [(balance + input.amountMinor).toString(), now, account.id]
    );
  });

  creditBuilderTotal.inc({ action: "authorized" });
  await logAudit({
    userId: input.userId,
    action: "starter.credit_builder.auth",
    resource: id,
    details: { amountMinor: input.amountMinor.toString(), merchant: input.merchant },
  });
  return (await getDb().queryOne<CardAuthRow>("SELECT * FROM card_authorizations WHERE id = ?", [id]))!;
}

export async function closeStatement(accountId: string, period: string): Promise<CreditBuilderStatementRow> {
  assertCreditBuilderEnabled();
  const account = await getDb().queryOne<CreditBuilderAccountRow>("SELECT * FROM credit_builder_accounts WHERE id = ?", [accountId]);
  if (!account) throw new AppError(ErrorCode.NOT_FOUND, "Account not found");

  const existing = await getDb().queryOne<CreditBuilderStatementRow>(
    "SELECT * FROM credit_builder_statements WHERE account_id = ? AND period = ?",
    [accountId, period]
  );
  if (existing) return existing;

  const closing = BigInt(account.statement_balance_minor);
  const limit = BigInt(account.secured_limit_minor);
  const utilizationBps = limit > 0n ? Number((closing * 10_000n) / limit) : 0;
  const id = uuidv4();
  const now = new Date().toISOString();

  await getDb().execute(
    `INSERT INTO credit_builder_statements
       (id, account_id, period, opening_minor, charges_minor, payments_minor, closing_minor, paid_on_time, utilization_bps, status, created_at)
     VALUES (?, ?, ?, '0', ?, '0', ?, 0, ?, 'open', ?)`,
    [id, accountId, period, closing.toString(), closing.toString(), utilizationBps, now]
  );
  creditBuilderTotal.inc({ action: "statement_closed" });
  return (await getDb().queryOne<CreditBuilderStatementRow>("SELECT * FROM credit_builder_statements WHERE id = ?", [id]))!;
}

export async function autopayStatement(guardianUserId: string, statementId: string, idempotencyKey: string): Promise<CreditBuilderStatementRow> {
  assertCreditBuilderEnabled();
  const stmt = await getDb().queryOne<CreditBuilderStatementRow>("SELECT * FROM credit_builder_statements WHERE id = ?", [statementId]);
  if (!stmt) throw new AppError(ErrorCode.NOT_FOUND, "Statement not found");
  if (stmt.status !== "open") throw new AppError(ErrorCode.CONFLICT, `Statement is ${stmt.status}`);

  const account = await getDb().queryOne<CreditBuilderAccountRow>("SELECT * FROM credit_builder_accounts WHERE id = ?", [stmt.account_id]);
  if (!account || account.guardian_user_id !== guardianUserId) throw new AppError(ErrorCode.FORBIDDEN, "Not your account");

  const due = BigInt(stmt.closing_minor);
  if (due > 0n) {
    const guardianCash = await getOrCreateUserAccount(guardianUserId, "user_cash", "USD");
    const clearing = await getSystemAccount("external_clearing", "USD");
    if ((await getBalance(guardianCash)) < due) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds for autopay");
    await postJournal(
      [
        { ledgerAccountId: guardianCash, direction: "debit", amountMinor: due, currency: "USD" },
        { ledgerAccountId: clearing, direction: "credit", amountMinor: due, currency: "USD" },
      ],
      `Credit-builder autopay ${stmt.period}`,
      { idempotencyKey: `cb:pay:${statementId}:${idempotencyKey}` }
    );
  }

  const now = new Date().toISOString();
  await getDb().execute(
    "UPDATE credit_builder_statements SET payments_minor = ?, paid_on_time = 1, status = 'paid', closing_minor = '0' WHERE id = ?",
    [stmt.closing_minor, statementId]
  );
  await getDb().execute(
    "UPDATE credit_builder_accounts SET statement_balance_minor = '0', updated_at = ? WHERE id = ?",
    [now, account.id]
  );
  creditBuilderTotal.inc({ action: "autopay" });
  await logAudit({ userId: guardianUserId, action: "starter.credit_builder.autopay", resource: statementId });
  return (await getDb().queryOne<CreditBuilderStatementRow>("SELECT * FROM credit_builder_statements WHERE id = ?", [statementId]))!;
}

export async function reportStatementToBureau(guardianUserId: string, statementId: string): Promise<{ reportId: string; externalRef: string }> {
  assertCreditBuilderEnabled();
  const stmt = await getDb().queryOne<CreditBuilderStatementRow>("SELECT * FROM credit_builder_statements WHERE id = ?", [statementId]);
  if (!stmt) throw new AppError(ErrorCode.NOT_FOUND, "Statement not found");
  const account = await getDb().queryOne<CreditBuilderAccountRow>("SELECT * FROM credit_builder_accounts WHERE id = ?", [stmt.account_id]);
  if (!account || account.guardian_user_id !== guardianUserId) throw new AppError(ErrorCode.FORBIDDEN, "Not your account");
  if (stmt.status !== "paid") throw new AppError(ErrorCode.VALIDATION, "Statement must be paid before bureau reporting");

  const result = await getCreditBureauReporter().submitReport({
    teenUserId: account.teen_user_id,
    guardianUserId,
    statementId,
    period: stmt.period,
    paidOnTime: stmt.paid_on_time === 1,
    utilizationBps: stmt.utilization_bps,
    closingBalanceMinor: BigInt(stmt.closing_minor),
  });

  const reportId = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO credit_bureau_reports (id, teen_user_id, guardian_user_id, statement_id, provider, external_ref, status, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reportId,
      account.teen_user_id,
      guardianUserId,
      statementId,
      getCreditBureauReporter().name,
      result.externalRef,
      result.status,
      JSON.stringify(result.payload),
      now,
    ]
  );
  await getDb().execute(
    "UPDATE credit_builder_statements SET bureau_report_id = ?, status = 'reported' WHERE id = ?",
    [reportId, statementId]
  );
  creditBuilderTotal.inc({ action: "bureau_reported" });
  await logAudit({ userId: guardianUserId, action: "starter.credit_builder.bureau_report", resource: reportId });
  return { reportId, externalRef: result.externalRef };
}

export async function getCreditBuilderAccount(teenUserId: string): Promise<CreditBuilderAccountRow | null> {
  return getDb().queryOne<CreditBuilderAccountRow>("SELECT * FROM credit_builder_accounts WHERE teen_user_id = ?", [teenUserId]);
}

export async function listStatements(accountId: string): Promise<CreditBuilderStatementRow[]> {
  return getDb().query<CreditBuilderStatementRow>(
    "SELECT * FROM credit_builder_statements WHERE account_id = ? ORDER BY period DESC",
    [accountId]
  );
}
