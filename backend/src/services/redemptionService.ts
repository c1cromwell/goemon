/**
 * Phase 18.6 — on-chain redemption for tokenized equities.
 *
 * A holder burns `qtyBase` tokens and the issuer delivers the underlying value. The whole
 * thing is ONE atomic, balanced, idempotent journal:
 *   - burn:    user_asset (debit)  → asset_treasury (credit)   [currency ASSET:<id>]
 *   - deliver: equity_issuer (debit) → user_cash (credit)      [currency USD, proceeds]
 * Idempotency is keyed on the caller's Idempotency-Key (`equity:redeem:<key>`); a replay
 * returns the original redemption and re-posts nothing. Proceeds = qtyBase * priceMinor
 * (per base unit, matching the marketplace). No money is ever represented as a float.
 *
 * (The "on-chain burn + custodial delivery" maps 1:1 to a real issuer/HTS burn in
 * production via the EquityIssuer provider; here the simulated issuer settles instantly.)
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { equityRedemptionTotal } from "../observability/metrics";
import { requireAsset } from "./tokenizationService";
import { getCurrentPrice } from "./pricingService";
import { getEquityIssuer, assertEquitiesEnabled } from "./equityIssuerService";
import {
  getAssetBalance,
  getOrCreateUserAssetAccount,
  getOrCreateAssetTreasury,
  getOrCreateUserAccount,
  getOrCreateSystemAccount,
  assetLedgerCode,
  postJournal,
} from "./ledgerService";

export interface RedemptionRow {
  id: string;
  asset_id: string;
  user_id: string;
  qty_base: string;
  proceeds_minor: string | null;
  currency: string;
  status: string;
  external_ref: string | null;
  journal_id: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface RedeemResult {
  redemptionId: string;
  journalId: string;
  proceedsMinor: bigint;
  externalRef: string;
}

export async function redeem(input: {
  userId: string;
  assetId: string;
  qtyBase: bigint;
  idempotencyKey: string;
}): Promise<RedeemResult> {
  assertEquitiesEnabled();
  const asset = await requireAsset(input.assetId);
  if (asset.kind !== "equity") throw new AppError(ErrorCode.VALIDATION, "Redemption applies to equity assets only");
  if (input.qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be a positive integer");

  const db = getDb();
  const ledgerKey = `equity:redeem:${input.idempotencyKey}`;

  // Idempotent replay: if the settlement journal already exists, return the prior redemption.
  const existingJournal = await db.queryOne<{ id: string }>(
    "SELECT id FROM ledger_journals WHERE idempotency_key = ?",
    [ledgerKey]
  );
  if (existingJournal) {
    const prior = await db.queryOne<RedemptionRow>("SELECT * FROM redemptions WHERE journal_id = ?", [existingJournal.id]);
    if (prior) {
      return {
        redemptionId: prior.id,
        journalId: existingJournal.id,
        proceedsMinor: BigInt(prior.proceeds_minor ?? "0"),
        externalRef: prior.external_ref ?? "",
      };
    }
  }

  const held = await getAssetBalance(input.userId, input.assetId);
  if (held < input.qtyBase) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient token balance to redeem");

  const price = await getCurrentPrice(input.assetId);
  const issuer = getEquityIssuer();
  const settlement = await issuer.submitRedemption({
    userId: input.userId,
    symbol: asset.symbol ?? asset.id,
    qtyBase: input.qtyBase,
    pricePerUnitMinor: price.priceMinor,
  });

  const userAssetAcct = await getOrCreateUserAssetAccount(input.userId, input.assetId);
  const treasuryAcct = await getOrCreateAssetTreasury(input.assetId);
  const issuerCash = await getOrCreateSystemAccount("equity_issuer", price.currency);
  const userCash = await getOrCreateUserAccount(input.userId, "user_cash", price.currency);
  const assetCode = assetLedgerCode(input.assetId);

  const journalId = await postJournal(
    [
      // burn the tokens back to the treasury
      { ledgerAccountId: userAssetAcct, direction: "debit", amountMinor: input.qtyBase, currency: assetCode },
      { ledgerAccountId: treasuryAcct, direction: "credit", amountMinor: input.qtyBase, currency: assetCode },
      // deliver proceeds from the issuer to the holder
      { ledgerAccountId: issuerCash, direction: "debit", amountMinor: settlement.proceedsMinor, currency: price.currency },
      { ledgerAccountId: userCash, direction: "credit", amountMinor: settlement.proceedsMinor, currency: price.currency },
    ],
    `Equity redemption ${asset.symbol ?? asset.id} x${input.qtyBase}`,
    { idempotencyKey: ledgerKey, externalRef: settlement.externalRef }
  );

  const redemptionId = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO redemptions (id, asset_id, user_id, qty_base, proceeds_minor, currency, status, external_ref, journal_id, created_at, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'settled', ?, ?, ?, ?)`,
    [redemptionId, input.assetId, input.userId, input.qtyBase.toString(), settlement.proceedsMinor.toString(),
     price.currency, settlement.externalRef, journalId, now, now]
  );

  equityRedemptionTotal.inc({ result: "settled" });
  await logAudit({
    userId: input.userId,
    action: "equity.redemption.settled",
    resource: redemptionId,
    details: { assetId: input.assetId, qtyBase: input.qtyBase.toString(), proceedsMinor: settlement.proceedsMinor.toString() },
  });

  return { redemptionId, journalId, proceedsMinor: settlement.proceedsMinor, externalRef: settlement.externalRef };
}

/** 1:1 backing attestation for an asset (delegates to the active issuer provider). */
export async function backingAttestation(assetId: string) {
  assertEquitiesEnabled();
  const asset = await requireAsset(assetId);
  if (asset.kind !== "equity") throw new AppError(ErrorCode.VALIDATION, "Backing applies to equity assets only");
  return getEquityIssuer().backingAttestation(asset.symbol ?? asset.id, asset.totalSupply);
}
