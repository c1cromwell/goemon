/**
 * Cross-currency settlement — the money-moving stage on top of the FX quote seam.
 *
 * Converts a user's balance from one currency to another as ONE balanced ledger
 * journal. The trick: a journal must net to zero PER currency group, so a
 * conversion spans two groups joined by an `fx_settlement` system account (the
 * treasury FX book), with an explicit spread fee in the TO currency:
 *
 *   FROM group:  debit  user(FROM)        fromAmountMinor
 *                credit fx_settlement(FROM) fromAmountMinor      → nets 0
 *   TO group:    debit  fx_settlement(TO)  grossToMinor
 *                credit user(TO)           netToMinor (= gross - fee)
 *                credit fee(TO)            feeMinor               → nets 0
 *
 * Money lives in the ledger (idempotent on the key, exactly-once); fx_conversions
 * is the append-only audit record. Gated by FX_SETTLEMENT_ENABLED (separate from
 * quotes — this touches money). Per-currency system accounts are created on demand,
 * so enabling a new currency needs no bootstrap step.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { fxConversionTotal } from "../observability/metrics";
import { assertSupported } from "./currencyRegistry";
import { getFxProvider, convertAmountMinor, ppmToDecimal } from "./fxRateService";
import { logAudit } from "./auditService";
import {
  getOrCreateUserAccount,
  getOrCreateSystemAccount,
  getBalance,
  postJournal,
} from "./ledgerService";

export interface ConversionResult {
  id: string;
  userId: string;
  from: string;
  to: string;
  fromAmountMinor: string;
  grossToMinor: string;
  feeMinor: string;
  toAmountMinor: string;
  rate: string;
  ratePpm: string;
  spreadBps: number;
  source: string;
  journalId: string;
}

function assertSettlementEnabled(): void {
  if (!config.FX_SETTLEMENT_ENABLED) {
    throw new AppError(ErrorCode.FX_DISABLED, "Cross-currency settlement is not enabled on this server");
  }
}

/**
 * Convert `fromAmountMinor` of the user's FROM balance into TO at the current
 * quoted rate, charging FX_SPREAD_BPS on the converted amount. Idempotent on the
 * key. Throws on disabled switch, unknown currency, same-currency, non-positive
 * amount, or insufficient balance — money never moves on a thrown path.
 */
export async function convert(input: {
  userId: string;
  from: string;
  to: string;
  fromAmountMinor: bigint;
  idempotencyKey: string;
}): Promise<ConversionResult> {
  assertSettlementEnabled();
  const from = assertSupported(input.from);
  const to = assertSupported(input.to);
  if (from.code === to.code) throw new AppError(ErrorCode.VALIDATION, "from and to currencies must differ");
  if (input.fromAmountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "fromAmountMinor must be positive");

  const db = getDb();

  // Idempotent replay — return the prior conversion without re-posting.
  const existing = await db.queryOne<RawConversion>("SELECT * FROM fx_conversions WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (existing) return mapConversion(existing);

  const rate = await getFxProvider().getRate(from.code, to.code);
  const grossToMinor = convertAmountMinor(input.fromAmountMinor, from.decimals, to.decimals, rate.ratePpm);
  if (grossToMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Converted amount rounds to zero — increase the amount");
  const spreadBps = BigInt(config.FX_SPREAD_BPS);
  const feeMinor = (grossToMinor * spreadBps) / 10_000n; // floor
  const netToMinor = grossToMinor - feeMinor;

  // Accounts (user TO + the fx_settlement/fee system accounts are created on demand).
  const userFrom = await getOrCreateUserAccount(input.userId, "user_cash", from.code);
  const userTo = await getOrCreateUserAccount(input.userId, "user_cash", to.code);
  const fxFrom = await getOrCreateSystemAccount("fx_settlement", from.code);
  const fxTo = await getOrCreateSystemAccount("fx_settlement", to.code);
  const feeTo = await getOrCreateSystemAccount("fee", to.code);

  const balance = await getBalance(userFrom);
  if (balance < input.fromAmountMinor) {
    fxConversionTotal.inc({ pair: `${from.code}/${to.code}`, result: "insufficient" });
    throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, `Insufficient ${from.code} balance`);
  }

  const entries = [
    // FROM currency group (nets to zero)
    { ledgerAccountId: userFrom, direction: "debit" as const, amountMinor: input.fromAmountMinor, currency: from.code },
    { ledgerAccountId: fxFrom, direction: "credit" as const, amountMinor: input.fromAmountMinor, currency: from.code },
    // TO currency group (nets to zero)
    { ledgerAccountId: fxTo, direction: "debit" as const, amountMinor: grossToMinor, currency: to.code },
    { ledgerAccountId: userTo, direction: "credit" as const, amountMinor: netToMinor, currency: to.code },
  ];
  if (feeMinor > 0n) {
    entries.push({ ledgerAccountId: feeTo, direction: "credit" as const, amountMinor: feeMinor, currency: to.code });
  }

  const journalId = await postJournal(
    entries,
    `FX ${from.code}→${to.code}`,
    { idempotencyKey: `fx:${input.idempotencyKey}` }
  );

  const id = uuidv4();
  await db.execute(
    `INSERT INTO fx_conversions
       (id, user_id, from_currency, to_currency, from_amount_minor, gross_to_minor, fee_minor, to_amount_minor, rate_ppm, spread_bps, source, journal_id, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.userId, from.code, to.code,
      input.fromAmountMinor.toString(), grossToMinor.toString(), feeMinor.toString(), netToMinor.toString(),
      rate.ratePpm.toString(), Number(spreadBps), rate.source, journalId, input.idempotencyKey, new Date().toISOString(),
    ]
  );
  await logAudit({
    userId: input.userId,
    action: "fx.convert",
    resource: id,
    details: { from: from.code, to: to.code, fromAmountMinor: input.fromAmountMinor.toString(), toAmountMinor: netToMinor.toString(), feeMinor: feeMinor.toString() },
  });
  fxConversionTotal.inc({ pair: `${from.code}/${to.code}`, result: "settled" });

  return mapConversion({
    id, user_id: input.userId, from_currency: from.code, to_currency: to.code,
    from_amount_minor: input.fromAmountMinor.toString(), gross_to_minor: grossToMinor.toString(),
    fee_minor: feeMinor.toString(), to_amount_minor: netToMinor.toString(),
    rate_ppm: rate.ratePpm.toString(), spread_bps: Number(spreadBps), source: rate.source, journal_id: journalId,
  });
}

export async function listConversions(userId: string, limit = 50): Promise<ConversionResult[]> {
  const rows = await getDb().query<RawConversion>(
    "SELECT * FROM fx_conversions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map(mapConversion);
}

interface RawConversion {
  id: string;
  user_id: string;
  from_currency: string;
  to_currency: string;
  from_amount_minor: string | number;
  gross_to_minor: string | number;
  fee_minor: string | number;
  to_amount_minor: string | number;
  rate_ppm: string | number;
  spread_bps: number;
  source: string;
  journal_id: string;
}

function mapConversion(r: RawConversion): ConversionResult {
  return {
    id: r.id,
    userId: r.user_id,
    from: r.from_currency,
    to: r.to_currency,
    fromAmountMinor: BigInt(r.from_amount_minor).toString(),
    grossToMinor: BigInt(r.gross_to_minor).toString(),
    feeMinor: BigInt(r.fee_minor).toString(),
    toAmountMinor: BigInt(r.to_amount_minor).toString(),
    rate: ppmToDecimal(BigInt(r.rate_ppm)),
    ratePpm: BigInt(r.rate_ppm).toString(),
    spreadBps: r.spread_bps,
    source: r.source,
    journalId: r.journal_id,
  };
}
