/**
 * X-Money response F1 — tokenized yield-bearing Treasury.
 *
 * The competitive counter to X Money's custodial 6% APY: instead of a balance the
 * platform holds (and can freeze, and that may be regulated away — the CLARITY-Act
 * risk), the user HOLDS a tokenized T-bill (`ATB`, $1 par) as their own non-custodial
 * ledger position, and **yield accrues to holders automatically** as a pro-rata cash
 * distribution. "Own a yield-bearing asset, not a balance someone can freeze."
 *
 * Maximum reuse: the yield engine is corporateActionService.distributeDividend
 * (pro-rata, idempotent per holder); the asset is a tokenizationService asset
 * (kind="treasury"); holdings are `user_asset` ledger positions; every move is a
 * balanced, idempotent ledger journal. Prototype seam, prod-fatal (it's a security).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { treasuryAccrualTotal } from "../observability/metrics";
import {
  assetLedgerCode,
  getBalance,
  getOrCreateAssetTreasury,
  getOrCreateSystemAccount,
  getOrCreateUserAccount,
  getOrCreateUserAssetAccount,
  postJournal,
} from "./ledgerService";
import { createAsset, listAssets, requireAsset, type Asset } from "./tokenizationService";
import { declareCorporateAction, distributeDividend } from "./corporateActionService";

const PAR_MINOR = 100n; // $1.00 per token (decimals 2)
const SETTLE_CURRENCY = "USD";
const TREASURY_SYMBOL = "ATB";

function assertTreasuryEnabled(): void {
  if (!config.TREASURY_ENABLED) {
    throw new AppError(ErrorCode.EQUITIES_DISABLED, "The tokenized treasury is currently unavailable");
  }
}

/** Create the demo treasury asset once (idempotent on symbol). */
export async function seedTreasury(): Promise<Asset> {
  const existing = (await listAssets("treasury")).find((a) => a.symbol === TREASURY_SYMBOL);
  if (existing) return existing;
  return createAsset({
    kind: "treasury",
    tokenStandard: "erc3643",
    name: "Argus T-Bill",
    symbol: TREASURY_SYMBOL,
    decimals: 2,
    minTier: 1,
    initialSupply: 1_000_000_000n, // ample par-priced supply for the prototype
    metadata: { parMinor: PAR_MINOR.toString(), apyBps: config.TREASURY_APY_BPS, backing: "simulated T-bill" },
  });
}

async function defaultTreasuryAsset(): Promise<Asset> {
  const a = (await listAssets("treasury")).find((x) => x.symbol === TREASURY_SYMBOL);
  if (!a) throw new AppError(ErrorCode.NOT_FOUND, "Treasury asset not seeded");
  return a;
}

/** Buy `qtyBase` treasury tokens at par (user_cash → token). Balance-gated, idempotent. */
export async function subscribe(input: { userId: string; qtyBase: bigint; idempotencyKey: string }): Promise<{ assetId: string; qtyBase: string; costMinor: string }> {
  assertTreasuryEnabled();
  if (input.qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be positive");
  const asset = await defaultTreasuryAsset();
  const code = assetLedgerCode(asset.id);
  const cost = input.qtyBase * PAR_MINOR;

  const cashId = await getOrCreateUserAccount(input.userId, "user_cash", SETTLE_CURRENCY);
  if ((await getBalance(cashId)) < cost) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient USD balance");

  const subSink = await getOrCreateSystemAccount("treasury_subscription", SETTLE_CURRENCY);
  const supply = await getOrCreateAssetTreasury(asset.id);
  if ((await getBalance(supply)) < input.qtyBase) throw new AppError(ErrorCode.CONFLICT, "Insufficient treasury supply");
  const holding = await getOrCreateUserAssetAccount(input.userId, asset.id);

  await postJournal(
    [
      // USD leg (nets to zero)
      { ledgerAccountId: cashId, direction: "debit", amountMinor: cost, currency: SETTLE_CURRENCY },
      { ledgerAccountId: subSink, direction: "credit", amountMinor: cost, currency: SETTLE_CURRENCY },
      // Token leg (nets to zero)
      { ledgerAccountId: supply, direction: "debit", amountMinor: input.qtyBase, currency: code },
      { ledgerAccountId: holding, direction: "credit", amountMinor: input.qtyBase, currency: code },
    ],
    `Treasury subscribe ${TREASURY_SYMBOL}`,
    { idempotencyKey: `treasury:sub:${input.idempotencyKey}` }
  );
  await logAudit({ userId: input.userId, action: "treasury.subscribe", resource: asset.id, details: { qtyBase: input.qtyBase.toString(), costMinor: cost.toString() } });
  return { assetId: asset.id, qtyBase: input.qtyBase.toString(), costMinor: cost.toString() };
}

/** Redeem `qtyBase` tokens back to cash at par (token → user_cash). Idempotent. */
export async function redeem(input: { userId: string; qtyBase: bigint; idempotencyKey: string }): Promise<{ assetId: string; qtyBase: string; proceedsMinor: string }> {
  assertTreasuryEnabled();
  if (input.qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be positive");
  const asset = await defaultTreasuryAsset();
  const code = assetLedgerCode(asset.id);
  const holding = await getOrCreateUserAssetAccount(input.userId, asset.id);
  if ((await getBalance(holding)) < input.qtyBase) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient treasury holding");

  const proceeds = input.qtyBase * PAR_MINOR;
  const cashId = await getOrCreateUserAccount(input.userId, "user_cash", SETTLE_CURRENCY);
  const subSink = await getOrCreateSystemAccount("treasury_subscription", SETTLE_CURRENCY);
  const supply = await getOrCreateAssetTreasury(asset.id);

  await postJournal(
    [
      { ledgerAccountId: subSink, direction: "debit", amountMinor: proceeds, currency: SETTLE_CURRENCY },
      { ledgerAccountId: cashId, direction: "credit", amountMinor: proceeds, currency: SETTLE_CURRENCY },
      { ledgerAccountId: holding, direction: "debit", amountMinor: input.qtyBase, currency: code },
      { ledgerAccountId: supply, direction: "credit", amountMinor: input.qtyBase, currency: code },
    ],
    `Treasury redeem ${TREASURY_SYMBOL}`,
    { idempotencyKey: `treasury:red:${input.idempotencyKey}` }
  );
  await logAudit({ userId: input.userId, action: "treasury.redeem", resource: asset.id, details: { qtyBase: input.qtyBase.toString(), proceedsMinor: proceeds.toString() } });
  return { assetId: asset.id, qtyBase: input.qtyBase.toString(), proceedsMinor: proceeds.toString() };
}

export interface AccrualResult {
  assetId: string;
  corporateActionId: string;
  perUnitMinor: string;
  holdersPaid: number;
  totalMinor: string;
}

/**
 * Accrue + distribute the period's yield to every holder. perUnit = par × APY ×
 * days/365 (integer floor), declared as a dividend and distributed pro-rata via the
 * existing corporate-action engine (idempotent per holder). This is the automatic
 * "your asset earns" pass-through — the anti-6%-APY.
 */
export async function accrueYield(input: { assetId?: string; periodDays?: number; apyBps?: number }): Promise<AccrualResult> {
  assertTreasuryEnabled();
  const asset = input.assetId ? await requireAsset(input.assetId) : await defaultTreasuryAsset();
  if (asset.kind !== "treasury") throw new AppError(ErrorCode.VALIDATION, "Not a treasury asset");
  const apyBps = BigInt(input.apyBps ?? config.TREASURY_APY_BPS);
  const days = BigInt(input.periodDays ?? 1);
  if (days <= 0n) throw new AppError(ErrorCode.VALIDATION, "periodDays must be positive");

  // yield per token (minor) for the period: par × apy(bps)/10000 × days/365, floored.
  const perUnit = (PAR_MINOR * apyBps * days) / (10_000n * 365n);
  if (perUnit <= 0n) throw new AppError(ErrorCode.VALIDATION, "Accrual rounds to zero — increase the period");

  const ca = await declareCorporateAction({ assetId: asset.id, type: "dividend", amountPerUnitMinor: perUnit, currency: SETTLE_CURRENCY });
  const dist = await distributeDividend(ca.id);

  await getDb().execute(
    `INSERT INTO treasury_accruals (id, asset_id, corporate_action_id, apy_bps, period_days, per_unit_minor, holders_paid, total_minor, as_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), asset.id, ca.id, Number(apyBps), Number(days), perUnit.toString(), dist.holdersPaid, dist.totalMinor.toString(), new Date().toISOString(), new Date().toISOString()]
  );
  treasuryAccrualTotal.inc({ asset: asset.symbol ?? asset.id }, dist.holdersPaid);
  return { assetId: asset.id, corporateActionId: ca.id, perUnitMinor: perUnit.toString(), holdersPaid: dist.holdersPaid, totalMinor: dist.totalMinor.toString() };
}

/** A user's treasury position + recent accruals. */
export async function positions(userId: string): Promise<{ assetId: string; symbol: string; qtyBase: string; valueMinor: string; apyBps: number; recentAccruals: unknown[] }> {
  const asset = await defaultTreasuryAsset();
  const holding = await getOrCreateUserAssetAccount(userId, asset.id);
  const qty = await getBalance(holding);
  const recent = await getDb().query("SELECT per_unit_minor, holders_paid, total_minor, as_of FROM treasury_accruals WHERE asset_id = ? ORDER BY created_at DESC LIMIT 10", [asset.id]);
  return { assetId: asset.id, symbol: TREASURY_SYMBOL, qtyBase: qty.toString(), valueMinor: (qty * PAR_MINOR).toString(), apyBps: config.TREASURY_APY_BPS, recentAccruals: recent };
}
