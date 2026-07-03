/**
 * Phase 18.6 — corporate actions (dividend distribution) for tokenized equities.
 *
 * A corporate action is an APPEND-ONLY declaration (corporate_actions). Distribution
 * posts ONE balanced ledger journal PER HOLDER (corporate_action system account → the
 * holder's user_cash), keyed idempotently on (corporateActionId, userId) so re-running
 * is exactly-once and never double-pays. Holders are derived from the ledger (the asset's
 * own `ASSET:<id>` currency), so this is the automatic dividend pass-through: hold the
 * token on the record date → receive cash. Amounts are integer minor units (never float):
 *   payout = amount_per_unit_minor * qtyBase   (per base unit; equity tokens are whole-share,
 *   matching the marketplace's `gross = qtyBase * priceMinor`).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { equityDividendTotal } from "../observability/metrics";
import { requireAsset } from "./tokenizationService";
import { assetKindDistributes } from "./assetTypeRegistry";
import { assertCorporateActionsEnabled } from "./equityIssuerService";
import {
  assetLedgerCode,
  getBalance,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  postJournal,
} from "./ledgerService";

export interface DeclareCorporateActionInput {
  assetId: string;
  type: "dividend" | "split";
  amountPerUnitMinor: bigint; // cash per whole share (minor units); 0 for non-cash splits
  currency?: string;
  exDate?: string;
  recordDate?: string;
  payDate?: string;
}

export interface CorporateActionRow {
  id: string;
  asset_id: string;
  type: string;
  amount_per_unit_minor: string;
  currency: string;
  ex_date: string | null;
  record_date: string | null;
  pay_date: string | null;
  created_at: string;
}

/** Declare a corporate action (append-only). */
export async function declareCorporateAction(input: DeclareCorporateActionInput): Promise<CorporateActionRow> {
  assertCorporateActionsEnabled();
  const asset = await requireAsset(input.assetId);
  if (!assetKindDistributes(asset.kind)) {
    throw new AppError(ErrorCode.VALIDATION, "Corporate actions apply only to income-producing assets (equity, treasury, real estate, royalty, security)");
  }
  const id = uuidv4();
  const currency = input.currency ?? "USD";
  await getDb().execute(
    `INSERT INTO corporate_actions (id, asset_id, type, amount_per_unit_minor, currency, ex_date, record_date, pay_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.assetId, input.type, input.amountPerUnitMinor.toString(), currency,
     input.exDate ?? null, input.recordDate ?? null, input.payDate ?? null, new Date().toISOString()]
  );
  await logAudit({ action: "equity.corporate_action.declared", resource: id, details: { assetId: input.assetId, type: input.type } });
  return (await getDb().queryOne<CorporateActionRow>("SELECT * FROM corporate_actions WHERE id = ?", [id]))!;
}

/** Holders of an asset (excludes treasury/equity system accounts) with their balances. */
async function holders(assetId: string): Promise<Array<{ userId: string; qtyBase: bigint }>> {
  const rows = await getDb().query<{ id: string; user_id: string }>(
    "SELECT id, user_id FROM ledger_accounts WHERE kind = 'user_asset' AND currency = ? AND user_id IS NOT NULL",
    [assetLedgerCode(assetId)]
  );
  const out: Array<{ userId: string; qtyBase: bigint }> = [];
  for (const r of rows) {
    const bal = await getBalance(r.id);
    if (bal > 0n) out.push({ userId: r.user_id, qtyBase: bal });
  }
  return out;
}

export function dividendPayout(qtyBase: bigint, amountPerUnitMinor: bigint): bigint {
  return qtyBase * amountPerUnitMinor;
}

export interface DistributionResult {
  corporateActionId: string;
  holdersPaid: number;
  totalMinor: bigint;
}

/**
 * Distribute a declared cash dividend to every current holder. Idempotent per holder
 * (key `equity:div:{caId}:{userId}`), so a replay or a partially-failed run is safe to
 * re-invoke. Posts corporate_action(debit) → user_cash(credit) per holder.
 */
export async function distributeDividend(corporateActionId: string): Promise<DistributionResult> {
  assertCorporateActionsEnabled();
  const ca = await getDb().queryOne<CorporateActionRow>("SELECT * FROM corporate_actions WHERE id = ?", [corporateActionId]);
  if (!ca) throw new AppError(ErrorCode.NOT_FOUND, "Corporate action not found");
  if (ca.type !== "dividend") throw new AppError(ErrorCode.VALIDATION, "Only dividend actions distribute cash");

  const asset = await requireAsset(ca.asset_id);
  const amountPerUnit = BigInt(ca.amount_per_unit_minor);
  const sourceId = await getOrCreateSystemAccount("corporate_action", ca.currency);

  let holdersPaid = 0;
  let totalMinor = 0n;
  for (const h of await holders(ca.asset_id)) {
    const payout = dividendPayout(h.qtyBase, amountPerUnit);
    if (payout <= 0n) continue;
    const divKey = `equity:div:${corporateActionId}:${h.userId}`;
    // Skip holders already paid (idempotent re-run) so holdersPaid reflects NEW payouts.
    const already = await getDb().queryOne<{ id: string }>(
      "SELECT id FROM ledger_journals WHERE idempotency_key = ?",
      [divKey]
    );
    if (already) continue;
    const cashId = await getOrCreateUserAccount(h.userId, "user_cash", ca.currency);
    await postJournal(
      [
        { ledgerAccountId: sourceId, direction: "debit", amountMinor: payout, currency: ca.currency },
        { ledgerAccountId: cashId, direction: "credit", amountMinor: payout, currency: ca.currency },
      ],
      `Dividend ${asset.symbol ?? asset.id} (${corporateActionId})`,
      { idempotencyKey: divKey }
    );
    equityDividendTotal.inc({ asset: asset.symbol ?? asset.id });
    holdersPaid++;
    totalMinor += payout;
  }

  await logAudit({
    action: "equity.dividend.distributed",
    resource: corporateActionId,
    details: { assetId: ca.asset_id, holdersPaid, totalMinor: totalMinor.toString() },
  });
  return { corporateActionId, holdersPaid, totalMinor };
}
