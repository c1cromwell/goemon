/**
 * X-Money response F6 — cross-border send (remittance) on the native rail.
 *
 * Send money to ANOTHER user in a different currency/corridor (e.g. USD/USDC → EURC),
 * settled on Goeman's own rail — no Visa, no US-only constraint. The global,
 * dollar-access audience X Money (US-centric via Visa/Cross River/FDIC) can't serve.
 *
 * Mechanics mirror fxSettlementService.convert, but cross-USER: ONE balanced journal
 * across two currency groups joined by the fx_settlement treasury, with the FX spread
 * as an explicit fee. Reuses the FX rate seam (getFxProvider/convertAmountMinor) and
 * the ledger; idempotent at the ledger. Gated by FX_SETTLEMENT_ENABLED (prod-fatal
 * while the rate provider is simulated).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { crossBorderSendTotal } from "../observability/metrics";
import { assertSupported } from "./currencyRegistry";
import { getFxProvider, convertAmountMinor, ppmToDecimal, quote } from "./fxRateService";
import { getBalance, getOrCreateSystemAccount, getOrCreateUserAccount, postJournal } from "./ledgerService";

function assertSettlementEnabled(): void {
  if (!config.FX_SETTLEMENT_ENABLED) throw new AppError(ErrorCode.FX_DISABLED, "Cross-border settlement is not enabled on this server");
}

export interface CrossBorderResult {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  from: string;
  to: string;
  fromAmountMinor: string;
  grossToMinor: string;
  feeMinor: string;
  toAmountMinor: string;
  rate: string;
  spreadBps: number;
  source: string;
  journalId: string;
}

/** Preview a corridor (recipient receives X) without moving money. Rides FX_ENABLED. */
export async function quoteCorridor(input: { from: string; to: string; amountMinor: bigint }) {
  return quote(input);
}

/**
 * Send `fromAmountMinor` of the sender's FROM balance to the recipient as TO at the
 * current rate, charging FX_SPREAD_BPS. Idempotent on the key. Throws on disabled
 * switch, unknown currency, same-currency, same-user, non-positive amount, or
 * insufficient balance — money never moves on a thrown path.
 */
export async function send(input: {
  senderUserId: string;
  recipientUserId: string;
  from: string;
  to: string;
  fromAmountMinor: bigint;
  idempotencyKey: string;
}): Promise<CrossBorderResult> {
  assertSettlementEnabled();
  const from = assertSupported(input.from);
  const to = assertSupported(input.to);
  if (from.code === to.code) throw new AppError(ErrorCode.VALIDATION, "Cross-border send is cross-currency; use a normal transfer for same-currency");
  if (input.senderUserId === input.recipientUserId) throw new AppError(ErrorCode.VALIDATION, "Sender and recipient must differ");
  if (input.fromAmountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "fromAmountMinor must be positive");

  const db = getDb();
  const existing = await db.queryOne<RawSend>("SELECT * FROM cross_border_sends WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (existing) return mapSend(existing);

  const rate = await getFxProvider().getRate(from.code, to.code);
  const grossTo = convertAmountMinor(input.fromAmountMinor, from.decimals, to.decimals, rate.ratePpm);
  if (grossTo <= 0n) throw new AppError(ErrorCode.VALIDATION, "Converted amount rounds to zero — increase the amount");
  const spreadBps = BigInt(config.FX_SPREAD_BPS);
  const feeMinor = (grossTo * spreadBps) / 10_000n;
  const netTo = grossTo - feeMinor;

  const senderFrom = await getOrCreateUserAccount(input.senderUserId, "user_cash", from.code);
  if ((await getBalance(senderFrom)) < input.fromAmountMinor) {
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, `Insufficient ${from.code} balance`);
  }
  const recipientTo = await getOrCreateUserAccount(input.recipientUserId, "user_cash", to.code);
  const fxFrom = await getOrCreateSystemAccount("fx_settlement", from.code);
  const fxTo = await getOrCreateSystemAccount("fx_settlement", to.code);
  const feeTo = await getOrCreateSystemAccount("fee", to.code);

  const entries = [
    // FROM group (sender → treasury) nets to zero
    { ledgerAccountId: senderFrom, direction: "debit" as const, amountMinor: input.fromAmountMinor, currency: from.code },
    { ledgerAccountId: fxFrom, direction: "credit" as const, amountMinor: input.fromAmountMinor, currency: from.code },
    // TO group (treasury → recipient + fee) nets to zero
    { ledgerAccountId: fxTo, direction: "debit" as const, amountMinor: grossTo, currency: to.code },
    { ledgerAccountId: recipientTo, direction: "credit" as const, amountMinor: netTo, currency: to.code },
  ];
  if (feeMinor > 0n) entries.push({ ledgerAccountId: feeTo, direction: "credit" as const, amountMinor: feeMinor, currency: to.code });

  const journalId = await postJournal(entries, `Cross-border ${from.code}→${to.code}`, { idempotencyKey: `xborder:${input.idempotencyKey}` });

  const id = uuidv4();
  await db.execute(
    `INSERT INTO cross_border_sends (id, sender_user_id, recipient_user_id, from_currency, to_currency, from_amount_minor, gross_to_minor, fee_minor, to_amount_minor, rate_ppm, spread_bps, source, journal_id, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.senderUserId, input.recipientUserId, from.code, to.code, input.fromAmountMinor.toString(), grossTo.toString(), feeMinor.toString(), netTo.toString(),
     rate.ratePpm.toString(), Number(spreadBps), rate.source, journalId, input.idempotencyKey, new Date().toISOString()]
  );
  crossBorderSendTotal.inc({ pair: `${from.code}/${to.code}` });
  await logAudit({ userId: input.senderUserId, action: "fx.cross_border.send", resource: id, details: { recipientUserId: input.recipientUserId, from: from.code, to: to.code, fromAmountMinor: input.fromAmountMinor.toString(), toAmountMinor: netTo.toString() } });

  return mapSend({
    id, sender_user_id: input.senderUserId, recipient_user_id: input.recipientUserId, from_currency: from.code, to_currency: to.code,
    from_amount_minor: input.fromAmountMinor.toString(), gross_to_minor: grossTo.toString(), fee_minor: feeMinor.toString(), to_amount_minor: netTo.toString(),
    rate_ppm: rate.ratePpm.toString(), spread_bps: Number(spreadBps), source: rate.source, journal_id: journalId,
  });
}

export async function listSends(userId: string, limit = 50): Promise<CrossBorderResult[]> {
  const rows = await getDb().query<RawSend>(
    "SELECT * FROM cross_border_sends WHERE sender_user_id = ? OR recipient_user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, userId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map(mapSend);
}

interface RawSend {
  id: string; sender_user_id: string; recipient_user_id: string; from_currency: string; to_currency: string;
  from_amount_minor: string | number; gross_to_minor: string | number; fee_minor: string | number; to_amount_minor: string | number;
  rate_ppm: string | number; spread_bps: number; source: string; journal_id: string;
}

function mapSend(r: RawSend): CrossBorderResult {
  return {
    id: r.id, senderUserId: r.sender_user_id, recipientUserId: r.recipient_user_id, from: r.from_currency, to: r.to_currency,
    fromAmountMinor: BigInt(r.from_amount_minor).toString(), grossToMinor: BigInt(r.gross_to_minor).toString(), feeMinor: BigInt(r.fee_minor).toString(),
    toAmountMinor: BigInt(r.to_amount_minor).toString(), rate: ppmToDecimal(BigInt(r.rate_ppm)), spreadBps: r.spread_bps, source: r.source, journalId: r.journal_id,
  };
}
