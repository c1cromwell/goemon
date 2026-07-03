/**
 * Capital formation / primary-raise rails (Phase 29 P5).
 *
 * A company raises capital by selling units of a tokenized (security/equity) asset under a
 * securities exemption. Investors COMMIT funds (escrowed); at close the raise SETTLES
 * (deliver units to each investor + release escrow to the issuer) if the target is met, or
 * REFUNDS everyone. This is the escrow subscribe→close/refund pattern batched at the offering
 * level, with per-exemption + per-asset compliance. No new money primitive.
 *
 * Gated by CAPITAL_RAISE_ENABLED (prod-fatal prototype). See docs/TOKENIZATION-MASTER-PLAN.md (P5).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { getProfile } from "./identityService";
import { getAsset } from "./tokenizationService";
import { checkTransfer } from "./complianceService";
import {
  assetLedgerCode, getOrCreateAssetTreasury, getOrCreateUserAssetAccount, getOrCreateUserAccount,
  getOrCreateSystemAccount, getBalance, postJournal,
} from "./ledgerService";

export type Exemption = "reg_cf" | "reg_d_506c" | "reg_a";

export interface Offering {
  id: string; assetId: string; issuerUserId: string; exemption: Exemption;
  priceMinor: bigint; currency: string; targetMinor: bigint; capMinor: bigint;
  minInvestmentMinor: bigint; maxInvestmentMinor: bigint | null;
  status: string; openedAt: string; closesAt: string | null; closedAt: string | null;
}
interface OfferingRow {
  id: string; asset_id: string; issuer_user_id: string; exemption: string;
  price_minor: string; currency: string; target_minor: string; cap_minor: string;
  min_investment_minor: string; max_investment_minor: string | null;
  status: string; opened_at: string; closes_at: string | null; closed_at: string | null;
}
function toOffering(r: OfferingRow): Offering {
  return {
    id: r.id, assetId: r.asset_id, issuerUserId: r.issuer_user_id, exemption: r.exemption as Exemption,
    priceMinor: BigInt(r.price_minor), currency: r.currency, targetMinor: BigInt(r.target_minor),
    capMinor: BigInt(r.cap_minor), minInvestmentMinor: BigInt(r.min_investment_minor),
    maxInvestmentMinor: r.max_investment_minor == null ? null : BigInt(r.max_investment_minor),
    status: r.status, openedAt: r.opened_at, closesAt: r.closes_at, closedAt: r.closed_at,
  };
}

export interface Investment {
  id: string; offeringId: string; investorUserId: string; units: bigint; amountMinor: bigint; status: string; createdAt: string;
}
interface InvestmentRow {
  id: string; offering_id: string; investor_user_id: string; units: string; amount_minor: string;
  status: string; escrow_journal_id: string | null; settle_journal_id: string | null; idempotency_key: string | null; created_at: string;
}
function toInvestment(r: InvestmentRow): Investment {
  return { id: r.id, offeringId: r.offering_id, investorUserId: r.investor_user_id, units: BigInt(r.units), amountMinor: BigInt(r.amount_minor), status: r.status, createdAt: r.created_at };
}

export function assertCapitalRaiseEnabled(): void {
  if (!config.CAPITAL_RAISE_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Capital raises are not enabled (set CAPITAL_RAISE_ENABLED=true).");
  }
}

const ESCROW_KIND = "raise_escrow";

export async function getOffering(id: string): Promise<Offering> {
  const r = await getDb().queryOne<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [id]);
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "Offering not found");
  return toOffering(r);
}

export async function listOpenOfferings(): Promise<Offering[]> {
  const rows = await getDb().query<OfferingRow>("SELECT * FROM offerings WHERE status = 'open' ORDER BY opened_at DESC");
  return rows.map(toOffering);
}

async function investmentsFor(offeringId: string): Promise<Investment[]> {
  const rows = await getDb().query<InvestmentRow>("SELECT * FROM offering_investments WHERE offering_id = ?", [offeringId]);
  return rows.map(toInvestment);
}

export async function listMyInvestments(userId: string): Promise<Investment[]> {
  const rows = await getDb().query<InvestmentRow>("SELECT * FROM offering_investments WHERE investor_user_id = ? ORDER BY created_at DESC", [userId]);
  return rows.map(toInvestment);
}

/** Live progress: total committed + investor count + units sold. */
export async function offeringProgress(offeringId: string): Promise<{ raisedMinor: string; investorCount: number; unitsSold: string; committedCount: number }> {
  const inv = await investmentsFor(offeringId);
  const live = inv.filter((i) => i.status === "committed" || i.status === "settled");
  const raised = live.reduce((a, i) => a + i.amountMinor, 0n);
  const units = live.reduce((a, i) => a + i.units, 0n);
  return { raisedMinor: raised.toString(), investorCount: new Set(live.map((i) => i.investorUserId)).size, unitsSold: units.toString(), committedCount: live.length };
}

export interface OpenOfferingInput {
  assetId: string; issuerUserId: string; exemption: Exemption;
  priceMinor: bigint; targetMinor: bigint; capMinor: bigint;
  minInvestmentMinor?: bigint; maxInvestmentMinor?: bigint; currency?: string; closesAt?: string;
}

export async function openOffering(input: OpenOfferingInput): Promise<Offering> {
  assertCapitalRaiseEnabled();
  const asset = await getAsset(input.assetId);
  if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  if (!asset.isSecurity) throw new AppError(ErrorCode.VALIDATION, "Capital raises require a security/equity asset");
  if (asset.issuerUserId && asset.issuerUserId !== input.issuerUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Only the asset issuer can open a raise for it");
  }
  if (input.priceMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "priceMinor must be positive");
  if (input.targetMinor <= 0n || input.capMinor < input.targetMinor) throw new AppError(ErrorCode.VALIDATION, "Require 0 < target ≤ cap");

  // The treasury must hold enough units to deliver the full cap at settlement.
  const maxUnits = input.capMinor / input.priceMinor;
  const treasury = await getOrCreateAssetTreasury(input.assetId);
  if ((await getBalance(treasury)) < maxUnits) {
    throw new AppError(ErrorCode.CONFLICT, `Treasury holds fewer than the ${maxUnits} units needed to cover the cap`);
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO offerings (id, asset_id, issuer_user_id, exemption, price_minor, currency, target_minor,
       cap_minor, min_investment_minor, max_investment_minor, status, opened_at, closes_at, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
    [id, input.assetId, input.issuerUserId, input.exemption, input.priceMinor.toString(), input.currency ?? asset.metadata?.currency ?? "USD",
     input.targetMinor.toString(), input.capMinor.toString(), (input.minInvestmentMinor ?? 0n).toString(),
     input.maxInvestmentMinor == null ? null : input.maxInvestmentMinor.toString(), now, input.closesAt ?? null]
  );
  await logAudit({ userId: input.issuerUserId, action: "raise.open", resource: id, details: { assetId: input.assetId, exemption: input.exemption, targetMinor: input.targetMinor.toString(), capMinor: input.capMinor.toString() } });
  return getOffering(id);
}

export async function invest(input: { offeringId: string; investorUserId: string; units: bigint; idempotencyKey: string }): Promise<Investment> {
  assertCapitalRaiseEnabled();
  const prior = await getDb().queryOne<InvestmentRow>("SELECT * FROM offering_investments WHERE idempotency_key = ?", [input.idempotencyKey]);
  if (prior) return toInvestment(prior);

  const offering = await getOffering(input.offeringId);
  if (offering.status !== "open") throw new AppError(ErrorCode.CONFLICT, "Offering is not open");
  if (input.units <= 0n) throw new AppError(ErrorCode.VALIDATION, "units must be positive");
  const amount = input.units * offering.priceMinor;

  // Per-investment minimum + per-investor maximum.
  if (amount < offering.minInvestmentMinor) throw new AppError(ErrorCode.VALIDATION, `Below the minimum investment of ${offering.minInvestmentMinor}`);
  if (offering.maxInvestmentMinor != null) {
    const mine = (await investmentsFor(offering.id)).filter((i) => i.investorUserId === input.investorUserId && i.status !== "refunded");
    const already = mine.reduce((a, i) => a + i.amountMinor, 0n);
    if (already + amount > offering.maxInvestmentMinor) throw new AppError(ErrorCode.VALIDATION, `Exceeds the per-investor maximum of ${offering.maxInvestmentMinor}`);
  }

  // Cap check.
  const raised = BigInt((await offeringProgress(offering.id)).raisedMinor);
  if (raised + amount > offering.capMinor) throw new AppError(ErrorCode.CONFLICT, "Investment would exceed the offering cap");

  // Exemption compliance: Reg D 506(c) is accredited-only.
  if (offering.exemption === "reg_d_506c") {
    const profile = await getProfile(input.investorUserId);
    if (!profile || Number(profile.accredited) !== 1) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, "This offering is open to accredited investors only");
  }
  // Asset compliance (tier / jurisdiction / holder-cap / whitelist / accreditation per the asset profile).
  const asset = (await getAsset(offering.assetId))!;
  const compliance = await checkTransfer(asset, input.investorUserId);
  if (!compliance.allowed) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, compliance.reason ?? "Not eligible for this offering");

  // Escrow the funds: investor cash → raise_escrow.
  const cash = await getOrCreateUserAccount(input.investorUserId, "user_cash", offering.currency);
  if ((await getBalance(cash)) < amount) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient cash for this investment");
  const escrow = await getOrCreateSystemAccount(ESCROW_KIND, offering.currency);
  const journalId = await postJournal(
    [
      { ledgerAccountId: cash, direction: "debit", amountMinor: amount, currency: offering.currency },
      { ledgerAccountId: escrow, direction: "credit", amountMinor: amount, currency: offering.currency },
    ],
    `Raise commitment ${offering.id}`,
    { idempotencyKey: `raise:commit:${input.idempotencyKey}` }
  );

  const id = uuidv4();
  await getDb().execute(
    `INSERT INTO offering_investments (id, offering_id, investor_user_id, units, amount_minor, status, escrow_journal_id, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, 'committed', ?, ?, ?)`,
    [id, offering.id, input.investorUserId, input.units.toString(), amount.toString(), journalId, input.idempotencyKey, new Date().toISOString()]
  );
  await logAudit({ userId: input.investorUserId, action: "raise.invest", resource: offering.id, details: { units: input.units.toString(), amountMinor: amount.toString() } });
  return toInvestment((await getDb().queryOne<InvestmentRow>("SELECT * FROM offering_investments WHERE id = ?", [id]))!);
}

export interface CloseResult { status: string; raisedMinor: string; settled: number; refunded: number }

/** Close the raise: settle (deliver units + release escrow) if target met, else refund all. */
export async function closeOffering(offeringId: string): Promise<CloseResult> {
  assertCapitalRaiseEnabled();
  const offering = await getOffering(offeringId);
  if (offering.status !== "open") throw new AppError(ErrorCode.CONFLICT, "Offering is not open");

  const committed = (await investmentsFor(offeringId)).filter((i) => i.status === "committed");
  const raised = committed.reduce((a, i) => a + i.amountMinor, 0n);
  const escrow = await getOrCreateSystemAccount(ESCROW_KIND, offering.currency);
  const code = assetLedgerCode(offering.assetId);
  const now = new Date().toISOString();

  if (raised >= offering.targetMinor) {
    // SETTLE — deliver units + release escrowed funds to the issuer.
    const treasury = await getOrCreateAssetTreasury(offering.assetId);
    const issuerCash = await getOrCreateUserAccount(offering.issuerUserId, "user_cash", offering.currency);
    for (const inv of committed) {
      const holder = await getOrCreateUserAssetAccount(inv.investorUserId, offering.assetId);
      const jid = await postJournal(
        [
          { ledgerAccountId: escrow, direction: "debit", amountMinor: inv.amountMinor, currency: offering.currency },
          { ledgerAccountId: issuerCash, direction: "credit", amountMinor: inv.amountMinor, currency: offering.currency },
          { ledgerAccountId: treasury, direction: "debit", amountMinor: inv.units, currency: code },
          { ledgerAccountId: holder, direction: "credit", amountMinor: inv.units, currency: code },
        ],
        `Raise settle ${offering.id}`,
        { idempotencyKey: `raise:settle:${inv.id}` }
      );
      await getDb().execute("UPDATE offering_investments SET status = 'settled', settle_journal_id = ? WHERE id = ?", [jid, inv.id]);
    }
    await getDb().execute("UPDATE offerings SET status = 'settled', closed_at = ? WHERE id = ?", [now, offeringId]);
    await logAudit({ userId: offering.issuerUserId, action: "raise.settle", resource: offeringId, details: { raisedMinor: raised.toString(), settled: committed.length } });
    return { status: "settled", raisedMinor: raised.toString(), settled: committed.length, refunded: 0 };
  }

  // REFUND — target not met.
  await refundCommitted(offering, committed, escrow);
  await getDb().execute("UPDATE offerings SET status = 'refunded', closed_at = ? WHERE id = ?", [now, offeringId]);
  await logAudit({ userId: offering.issuerUserId, action: "raise.refund", resource: offeringId, details: { raisedMinor: raised.toString(), refunded: committed.length } });
  return { status: "refunded", raisedMinor: raised.toString(), settled: 0, refunded: committed.length };
}

export async function cancelOffering(offeringId: string): Promise<CloseResult> {
  assertCapitalRaiseEnabled();
  const offering = await getOffering(offeringId);
  if (offering.status !== "open") throw new AppError(ErrorCode.CONFLICT, "Offering is not open");
  const committed = (await investmentsFor(offeringId)).filter((i) => i.status === "committed");
  const escrow = await getOrCreateSystemAccount(ESCROW_KIND, offering.currency);
  await refundCommitted(offering, committed, escrow);
  await getDb().execute("UPDATE offerings SET status = 'cancelled', closed_at = ? WHERE id = ?", [new Date().toISOString(), offeringId]);
  await logAudit({ userId: offering.issuerUserId, action: "raise.cancel", resource: offeringId, details: { refunded: committed.length } });
  return { status: "cancelled", raisedMinor: "0", settled: 0, refunded: committed.length };
}

async function refundCommitted(offering: Offering, committed: Investment[], escrowAccountId: string): Promise<void> {
  for (const inv of committed) {
    const cash = await getOrCreateUserAccount(inv.investorUserId, "user_cash", offering.currency);
    const jid = await postJournal(
      [
        { ledgerAccountId: escrowAccountId, direction: "debit", amountMinor: inv.amountMinor, currency: offering.currency },
        { ledgerAccountId: cash, direction: "credit", amountMinor: inv.amountMinor, currency: offering.currency },
      ],
      `Raise refund ${offering.id}`,
      { idempotencyKey: `raise:refund:${inv.id}` }
    );
    await getDb().execute("UPDATE offering_investments SET status = 'refunded', settle_journal_id = ? WHERE id = ?", [jid, inv.id]);
  }
}
