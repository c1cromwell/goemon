/**
 * Employee equity compensation (Phase 29 P4).
 *
 * Grants of an `equity` asset to recipients with a vesting schedule — the runnable
 * expression of docs/legal/EQUITY-INCENTIVE-PLAN.md. Award types:
 *   - unit_award       restricted units; vested units delivered on `release`.
 *   - profits_interest LLC profits interest (threshold recorded); delivered like a unit award.
 *   - option           right to buy units at exercise_price; vested units are exercisable.
 *
 * Reuses the engine: units live in the asset's ledger currency code, delivery is a
 * balanced treasury→recipient journal (idempotent), and cap-table/vesting are pure
 * projections. No new money primitive. Gated by EQUITY_COMP_ENABLED (prod-fatal prototype).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getProfile } from "./identityService";
import { getAsset } from "./tokenizationService";
import {
  assetLedgerCode,
  getOrCreateAssetTreasury,
  getOrCreateUserAssetAccount,
  getOrCreateUserAccount,
  getOrCreateSystemAccount,
  getBalance,
  postJournal,
} from "./ledgerService";

export type AwardType = "unit_award" | "profits_interest" | "option";

export interface EquityGrant {
  id: string;
  assetId: string;
  recipientUserId: string;
  grantorUserId: string | null;
  awardType: AwardType;
  unitsTotal: bigint;
  unitsReleased: bigint; // delivered (award) or exercised (option)
  exercisePriceMinor: bigint;
  thresholdMinor: bigint;
  currency: string;
  vestStart: string;
  cliffMonths: number;
  durationMonths: number;
  eightyThreeBFiled: boolean;
  eightyThreeBDeadline: string | null;
  status: string;
  createdAt: string;
}

interface GrantRow {
  id: string; asset_id: string; recipient_user_id: string; grantor_user_id: string | null;
  award_type: string; units_total: string; units_released: string; exercise_price_minor: string;
  threshold_minor: string; currency: string; vest_start: string; cliff_months: number;
  duration_months: number; eighty_three_b_filed: number; eighty_three_b_deadline: string | null;
  status: string; created_at: string;
}

function toGrant(r: GrantRow): EquityGrant {
  return {
    id: r.id, assetId: r.asset_id, recipientUserId: r.recipient_user_id, grantorUserId: r.grantor_user_id,
    awardType: r.award_type as AwardType, unitsTotal: BigInt(r.units_total), unitsReleased: BigInt(r.units_released),
    exercisePriceMinor: BigInt(r.exercise_price_minor), thresholdMinor: BigInt(r.threshold_minor), currency: r.currency,
    vestStart: r.vest_start, cliffMonths: r.cliff_months, durationMonths: r.duration_months,
    eightyThreeBFiled: !!r.eighty_three_b_filed, eightyThreeBDeadline: r.eighty_three_b_deadline,
    status: r.status, createdAt: r.created_at,
  };
}

export function assertEquityCompEnabled(): void {
  if (!config.EQUITY_COMP_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Equity compensation is not enabled (set EQUITY_COMP_ENABLED=true).");
  }
}

/** Whole months elapsed from `startISO` to `asOf` (a partial month doesn't count). */
function monthsElapsed(startISO: string, asOf: Date): number {
  const s = new Date(startISO);
  let m = (asOf.getUTCFullYear() - s.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - s.getUTCMonth());
  if (asOf.getUTCDate() < s.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/** Units vested as of `asOf`: 0 before the cliff, then linear to the full amount at duration. */
export function computeVested(grant: EquityGrant, asOf: Date = new Date()): bigint {
  const elapsed = monthsElapsed(grant.vestStart, asOf);
  if (elapsed < grant.cliffMonths) return 0n;
  if (elapsed >= grant.durationMonths) return grant.unitsTotal;
  return (grant.unitsTotal * BigInt(elapsed)) / BigInt(grant.durationMonths);
}

async function rowById(id: string): Promise<GrantRow> {
  const r = await getDb().queryOne<GrantRow>("SELECT * FROM equity_grants WHERE id = ?", [id]);
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "Grant not found");
  return r;
}

export async function getGrant(id: string): Promise<EquityGrant> {
  return toGrant(await rowById(id));
}

export async function listGrantsForRecipient(userId: string): Promise<EquityGrant[]> {
  const rows = await getDb().query<GrantRow>("SELECT * FROM equity_grants WHERE recipient_user_id = ? ORDER BY created_at DESC", [userId]);
  return rows.map(toGrant);
}

export async function listGrantsForAsset(assetId: string): Promise<EquityGrant[]> {
  const rows = await getDb().query<GrantRow>("SELECT * FROM equity_grants WHERE asset_id = ? ORDER BY created_at DESC", [assetId]);
  return rows.map(toGrant);
}

export interface CreateGrantInput {
  assetId: string;
  recipientUserId: string;
  grantorUserId?: string;
  awardType: AwardType;
  unitsTotal: bigint;
  exercisePriceMinor?: bigint;
  thresholdMinor?: bigint;
  currency?: string;
  vestStart?: string;
  cliffMonths?: number;
  durationMonths?: number;
}

/** Units still held in the treasury that aren't reserved by an active grant. */
async function availableToGrant(assetId: string): Promise<bigint> {
  const treasury = await getOrCreateAssetTreasury(assetId);
  const inTreasury = await getBalance(treasury);
  const grants = await listGrantsForAsset(assetId);
  const reserved = grants
    .filter((g) => g.status !== "cancelled")
    .reduce((acc, g) => acc + (g.unitsTotal - g.unitsReleased), 0n);
  return inTreasury - reserved;
}

export async function createGrant(input: CreateGrantInput): Promise<EquityGrant> {
  assertEquityCompEnabled();
  const asset = await getAsset(input.assetId);
  if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  if (asset.kind !== "equity") throw new AppError(ErrorCode.VALIDATION, "Equity compensation grants require an `equity` asset");
  if (input.unitsTotal <= 0n) throw new AppError(ErrorCode.VALIDATION, "unitsTotal must be positive");
  if (!(await getProfile(input.recipientUserId))) throw new AppError(ErrorCode.VALIDATION, "Recipient is not on the identity registry");
  if (input.awardType === "option" && (input.exercisePriceMinor ?? 0n) <= 0n) {
    throw new AppError(ErrorCode.VALIDATION, "Options require a positive exercise price");
  }

  const available = await availableToGrant(input.assetId);
  if (input.unitsTotal > available) {
    throw new AppError(ErrorCode.CONFLICT, `Only ${available} units are available to grant from the pool`);
  }

  const id = uuidv4();
  const now = new Date();
  const vestStart = input.vestStart ?? now.toISOString();
  const deadline = new Date(new Date(vestStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await getDb().execute(
    `INSERT INTO equity_grants
       (id, asset_id, recipient_user_id, grantor_user_id, award_type, units_total, units_released,
        exercise_price_minor, threshold_minor, currency, vest_start, cliff_months, duration_months,
        eighty_three_b_filed, eighty_three_b_deadline, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)`,
    [
      id, input.assetId, input.recipientUserId, input.grantorUserId ?? asset.issuerUserId ?? null, input.awardType,
      input.unitsTotal.toString(), (input.exercisePriceMinor ?? 0n).toString(), (input.thresholdMinor ?? 0n).toString(),
      input.currency ?? "USD", vestStart, input.cliffMonths ?? 12, input.durationMonths ?? 48, deadline, now.toISOString(),
    ]
  );
  await logAudit({ userId: input.grantorUserId ?? undefined, action: "equity.grant", resource: id, details: { assetId: input.assetId, recipient: input.recipientUserId, awardType: input.awardType, units: input.unitsTotal.toString() } });
  return getGrant(id);
}

/** Deliver newly-vested units to the recipient (unit_award / profits_interest). Idempotent. */
export async function releaseVested(grantId: string, asOf: Date = new Date()): Promise<EquityGrant> {
  assertEquityCompEnabled();
  const grant = await getGrant(grantId);
  if (grant.awardType === "option") throw new AppError(ErrorCode.VALIDATION, "Options are exercised, not released");
  const vested = computeVested(grant, asOf);
  const toRelease = vested - grant.unitsReleased;
  if (toRelease <= 0n) return grant; // nothing new vested

  const code = assetLedgerCode(grant.assetId);
  const treasury = await getOrCreateAssetTreasury(grant.assetId);
  const holder = await getOrCreateUserAssetAccount(grant.recipientUserId, grant.assetId);
  await postJournal(
    [
      { ledgerAccountId: treasury, direction: "debit", amountMinor: toRelease, currency: code },
      { ledgerAccountId: holder, direction: "credit", amountMinor: toRelease, currency: code },
    ],
    `Equity vest release ${grant.id}`,
    { idempotencyKey: `equitycomp:release:${grant.id}:${vested.toString()}` }
  );
  const status = vested >= grant.unitsTotal ? "fully_released" : "active";
  await getDb().execute("UPDATE equity_grants SET units_released = ?, status = ? WHERE id = ?", [vested.toString(), status, grant.id]);
  await logAudit({ userId: grant.recipientUserId, action: "equity.release", resource: grant.id, details: { released: toRelease.toString(), vestedTotal: vested.toString() } });
  return getGrant(grant.id);
}

/** Exercise `qty` vested options: pay the exercise price, receive the units. Idempotent. */
export async function exercise(input: { grantId: string; qty: bigint; idempotencyKey: string; asOf?: Date }): Promise<EquityGrant> {
  assertEquityCompEnabled();
  const grant = await getGrant(input.grantId);
  if (grant.awardType !== "option") throw new AppError(ErrorCode.VALIDATION, "Only options can be exercised");
  if (input.qty <= 0n) throw new AppError(ErrorCode.VALIDATION, "qty must be positive");
  const exercisable = computeVested(grant, input.asOf ?? new Date()) - grant.unitsReleased;
  if (input.qty > exercisable) throw new AppError(ErrorCode.VALIDATION, `Only ${exercisable} options are vested and exercisable`);

  const cost = input.qty * grant.exercisePriceMinor;
  const code = assetLedgerCode(grant.assetId);
  const cash = await getOrCreateUserAccount(grant.recipientUserId, "user_cash", grant.currency);
  if ((await getBalance(cash)) < cost) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient cash for the exercise price");
  // Proceeds go to the granting company if known, else a system account.
  const proceeds = grant.grantorUserId
    ? await getOrCreateUserAccount(grant.grantorUserId, "user_cash", grant.currency)
    : await getOrCreateSystemAccount("equity_exercise", grant.currency);
  const treasury = await getOrCreateAssetTreasury(grant.assetId);
  const holder = await getOrCreateUserAssetAccount(grant.recipientUserId, grant.assetId);

  await postJournal(
    [
      // cash leg (nets to zero)
      { ledgerAccountId: cash, direction: "debit", amountMinor: cost, currency: grant.currency },
      { ledgerAccountId: proceeds, direction: "credit", amountMinor: cost, currency: grant.currency },
      // asset leg (nets to zero)
      { ledgerAccountId: treasury, direction: "debit", amountMinor: input.qty, currency: code },
      { ledgerAccountId: holder, direction: "credit", amountMinor: input.qty, currency: code },
    ],
    `Option exercise ${grant.id}`,
    { idempotencyKey: `equitycomp:exercise:${input.idempotencyKey}` }
  );
  const released = grant.unitsReleased + input.qty;
  const status = released >= grant.unitsTotal ? "fully_released" : "active";
  await getDb().execute("UPDATE equity_grants SET units_released = ?, status = ? WHERE id = ?", [released.toString(), status, grant.id]);
  await logAudit({ userId: grant.recipientUserId, action: "equity.exercise", resource: grant.id, details: { qty: input.qty.toString(), costMinor: cost.toString() } });
  return getGrant(grant.id);
}

export async function mark83bFiled(grantId: string): Promise<EquityGrant> {
  assertEquityCompEnabled();
  await rowById(grantId);
  await getDb().execute("UPDATE equity_grants SET eighty_three_b_filed = 1 WHERE id = ?", [grantId]);
  return getGrant(grantId);
}

export interface CapTable {
  assetId: string;
  symbol: string | null;
  totalSupply: string;
  totalGranted: string;
  totalReleased: string;
  unallocated: string;
  grants: {
    grantId: string; recipientUserId: string; awardType: AwardType;
    unitsTotal: string; vested: string; released: string; status: string;
  }[];
}

/** Issuer cap-table view over an equity asset. */
export async function capTable(assetId: string, asOf: Date = new Date()): Promise<CapTable> {
  const asset = await getAsset(assetId);
  if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  const grants = await listGrantsForAsset(assetId);
  const totalGranted = grants.reduce((a, g) => a + g.unitsTotal, 0n);
  const totalReleased = grants.reduce((a, g) => a + g.unitsReleased, 0n);
  const unallocated = asset.totalSupply - totalGranted;
  return {
    assetId, symbol: asset.symbol, totalSupply: asset.totalSupply.toString(),
    totalGranted: totalGranted.toString(), totalReleased: totalReleased.toString(),
    unallocated: (unallocated > 0n ? unallocated : 0n).toString(),
    grants: grants.map((g) => ({
      grantId: g.id, recipientUserId: g.recipientUserId, awardType: g.awardType,
      unitsTotal: g.unitsTotal.toString(), vested: computeVested(g, asOf).toString(),
      released: g.unitsReleased.toString(), status: g.status,
    })),
  };
}
