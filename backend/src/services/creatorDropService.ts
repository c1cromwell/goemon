/**
 * X-Money response F5 — collector/creator drops.
 *
 * Re-aims X Money's creator-payout hook to tokenized GOODS the creator owns: a
 * creator issues a LIMITED, authenticated tokenized edition (a marketplace asset,
 * kind=collectible, supply = edition size); fans CLAIM editions they own (a token in
 * their non-custodial position), paying the creator DIRECTLY — no ad-revenue
 * middleman, no platform that can deplatform the creator. The edition size enforces
 * scarcity at the LEDGER (the asset treasury IS the cap), and each claim is a
 * balanced, idempotent journal. Prototype seam, prod-fatal (marketplace-intermediary
 * + collectible-as-goods counsel, like the collectibles escrow).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { creatorDropClaimTotal } from "../observability/metrics";
import { createAsset } from "./tokenizationService";
import {
  assetLedgerCode,
  getBalance,
  getOrCreateAssetTreasury,
  getOrCreateUserAccount,
  getOrCreateUserAssetAccount,
  postJournal,
} from "./ledgerService";

const MAX_EDITION = 1_000_000;
const MAX_PRICE_MINOR = 10_000_000n;

function assertEnabled(): void {
  if (!config.CREATOR_DROPS_ENABLED) throw new AppError(ErrorCode.CREATOR_DROPS_DISABLED, "Creator drops are currently unavailable");
}

export interface DropRow {
  id: string;
  assetId: string;
  creatorUserId: string;
  name: string;
  editionSize: number;
  priceMinor: string;
  currency: string;
  memo: string | null;
  certNumber: string | null;
  claimedCount: number;
  status: "active" | "sold_out" | "ended";
  createdAt: string;
}

interface RawDrop {
  id: string; asset_id: string; creator_user_id: string; name: string; edition_size: number;
  price_minor: string | number; currency: string; memo: string | null; cert_number: string | null;
  claimed_count: number; status: "active" | "sold_out" | "ended"; created_at: string;
}

function map(r: RawDrop): DropRow {
  return {
    id: r.id, assetId: r.asset_id, creatorUserId: r.creator_user_id, name: r.name,
    editionSize: Number(r.edition_size), priceMinor: BigInt(r.price_minor).toString(), currency: r.currency,
    memo: r.memo, certNumber: r.cert_number, claimedCount: Number(r.claimed_count), status: r.status, createdAt: r.created_at,
  };
}

export async function createDrop(input: {
  creatorUserId: string;
  name: string;
  symbol?: string;
  editionSize: number;
  priceMinor: bigint;
  currency?: string;
  memo?: string;
  certNumber?: string;
}): Promise<DropRow> {
  assertEnabled();
  if (!input.name?.trim()) throw new AppError(ErrorCode.VALIDATION, "Drop name required");
  if (!Number.isInteger(input.editionSize) || input.editionSize <= 0 || input.editionSize > MAX_EDITION) {
    throw new AppError(ErrorCode.VALIDATION, "editionSize out of range");
  }
  if (input.priceMinor <= 0n || input.priceMinor > MAX_PRICE_MINOR) throw new AppError(ErrorCode.VALIDATION, "price out of range");

  // Issue the tokenized edition: a whole-unit collectible asset, supply = edition size.
  const asset = await createAsset({
    kind: "collectible",
    tokenStandard: "hts",
    name: input.name.trim(),
    symbol: input.symbol,
    decimals: 0,
    issuerUserId: input.creatorUserId,
    initialSupply: BigInt(input.editionSize),
    metadata: { drop: true, creatorUserId: input.creatorUserId, certNumber: input.certNumber ?? null, memo: input.memo ?? null },
  });

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO creator_drops (id, asset_id, creator_user_id, name, edition_size, price_minor, currency, memo, cert_number, claimed_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
    [id, asset.id, input.creatorUserId, input.name.trim(), input.editionSize, input.priceMinor.toString(), input.currency ?? "USD", input.memo ?? null, input.certNumber ?? null, now, now]
  );
  await logAudit({ userId: input.creatorUserId, action: "drop.create", resource: id, details: { assetId: asset.id, editionSize: input.editionSize, priceMinor: input.priceMinor.toString() } });
  return (await getDrop(id))!;
}

export async function getDrop(id: string): Promise<DropRow | null> {
  const r = await getDb().queryOne<RawDrop>("SELECT * FROM creator_drops WHERE id = ?", [id]);
  return r ? map(r) : null;
}

export async function listDrops(creatorUserId?: string, limit = 50): Promise<DropRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = creatorUserId
    ? await getDb().query<RawDrop>("SELECT * FROM creator_drops WHERE creator_user_id = ? ORDER BY created_at DESC LIMIT ?", [creatorUserId, capped])
    : await getDb().query<RawDrop>("SELECT * FROM creator_drops WHERE status = 'active' ORDER BY created_at DESC LIMIT ?", [capped]);
  return rows.map(map);
}

export interface ClaimResult {
  dropId: string;
  editionNumber: number;
  assetId: string;
  journalId: string;
  status: DropRow["status"];
}

/**
 * Claim one edition: the buyer pays the creator and receives one token they own.
 * The asset treasury (supply = edition size) is the hard scarcity cap — when it hits
 * zero the drop is sold out. Idempotent on the key; never over-mints the edition.
 */
export async function claimDrop(input: { dropId: string; buyerUserId: string; idempotencyKey: string }): Promise<ClaimResult> {
  assertEnabled();
  const db = getDb();

  const existing = await db.queryOne<{ drop_id: string; edition_number: number; journal_id: string }>(
    "SELECT drop_id, edition_number, journal_id FROM drop_claims WHERE idempotency_key = ?",
    [input.idempotencyKey]
  );
  const dropRaw = await db.queryOne<RawDrop>("SELECT * FROM creator_drops WHERE id = ?", [input.dropId]);
  if (!dropRaw) throw new AppError(ErrorCode.NOT_FOUND, "Drop not found");
  if (existing) {
    return { dropId: existing.drop_id, editionNumber: existing.edition_number, assetId: dropRaw.asset_id, journalId: existing.journal_id, status: map(dropRaw).status };
  }
  if (dropRaw.status !== "active") throw new AppError(ErrorCode.CONFLICT, `Drop is ${dropRaw.status}`);
  if (input.buyerUserId === dropRaw.creator_user_id) throw new AppError(ErrorCode.VALIDATION, "Cannot claim your own drop");

  const price = BigInt(dropRaw.price_minor);
  const code = assetLedgerCode(dropRaw.asset_id);

  const buyerCash = await getOrCreateUserAccount(input.buyerUserId, "user_cash", dropRaw.currency);
  if ((await getBalance(buyerCash)) < price) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");
  const creatorCash = await getOrCreateUserAccount(dropRaw.creator_user_id, "user_cash", dropRaw.currency);
  const supply = await getOrCreateAssetTreasury(dropRaw.asset_id);
  if ((await getBalance(supply)) < 1n) {
    await db.execute("UPDATE creator_drops SET status = 'sold_out', updated_at = ? WHERE id = ?", [new Date().toISOString(), dropRaw.id]);
    throw new AppError(ErrorCode.CONFLICT, "Drop is sold out");
  }
  const holding = await getOrCreateUserAssetAccount(input.buyerUserId, dropRaw.asset_id);

  const journalId = await postJournal(
    [
      // Cash leg: buyer → creator (paid directly).
      { ledgerAccountId: buyerCash, direction: "debit", amountMinor: price, currency: dropRaw.currency },
      { ledgerAccountId: creatorCash, direction: "credit", amountMinor: price, currency: dropRaw.currency },
      // Token leg: one edition treasury → buyer.
      { ledgerAccountId: supply, direction: "debit", amountMinor: 1n, currency: code },
      { ledgerAccountId: holding, direction: "credit", amountMinor: 1n, currency: code },
    ],
    `Drop claim ${dropRaw.name}`,
    { idempotencyKey: `drop:claim:${input.idempotencyKey}` }
  );

  const editionNumber = Number(dropRaw.claimed_count) + 1;
  await db.execute(
    "INSERT INTO drop_claims (id, drop_id, buyer_user_id, edition_number, journal_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [uuidv4(), dropRaw.id, input.buyerUserId, editionNumber, journalId, input.idempotencyKey, new Date().toISOString()]
  );
  const soldOut = editionNumber >= Number(dropRaw.edition_size);
  await db.execute("UPDATE creator_drops SET claimed_count = ?, status = ?, updated_at = ? WHERE id = ?", [editionNumber, soldOut ? "sold_out" : "active", new Date().toISOString(), dropRaw.id]);

  creatorDropClaimTotal.inc();
  await logAudit({ userId: input.buyerUserId, action: "drop.claim", resource: dropRaw.id, details: { editionNumber, priceMinor: price.toString(), creatorUserId: dropRaw.creator_user_id } });
  return { dropId: dropRaw.id, editionNumber, assetId: dropRaw.asset_id, journalId, status: soldOut ? "sold_out" : "active" };
}

export async function myClaims(userId: string, limit = 50): Promise<unknown[]> {
  return getDb().query(
    "SELECT c.drop_id, c.edition_number, c.created_at, d.name, d.asset_id FROM drop_claims c JOIN creator_drops d ON d.id = c.drop_id WHERE c.buyer_user_id = ? ORDER BY c.created_at DESC LIMIT ?",
    [userId, Math.min(Math.max(limit, 1), 200)]
  );
}
