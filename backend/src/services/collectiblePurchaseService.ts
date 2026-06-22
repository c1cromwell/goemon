/**
 * Seller P2P collectible purchases — in-app USDC escrow without a vault/custody partner.
 *
 * Flow (Corp B posture — Argus holds funds as intermediary until buyer confirms receipt):
 *   purchase  → escrow hold (buyer → escrow), listing paused
 *   ship      → seller marks shipped
 *   confirm   → escrow release (escrow → seller) + treasury → buyer asset delivery
 *   refund    → escrow refund (escrow → buyer), listing back to public
 *   dispute   → funds stay held; admin resolve rides escrowService + syncFromEscrowResolution
 *
 * Instant treasury `placeOrder` is blocked for `listingType: seller_p2p` assets.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isAccountFrozen } from "./accountHoldService";
import { hold, release, refund as escrowRefund, openDispute, type Resolution } from "./escrowService";
import { getAsset, requireAsset, type Asset } from "./tokenizationService";
import { getCurrentListing, transitionListing, isTradeable } from "./listingService";
import { deliverFromTreasury } from "./marketplaceService";

export type PurchaseStatus = "escrow_held" | "shipped" | "completed" | "refunded" | "disputed";

const OPEN_STATUSES: PurchaseStatus[] = ["escrow_held", "shipped", "disputed"];

export interface CollectiblePurchaseRow {
  id: string;
  assetId: string;
  buyerUserId: string;
  sellerUserId: string;
  escrowId: string;
  amountMinor: string;
  currency: string;
  status: PurchaseStatus;
  shippedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawPurchase {
  id: string;
  asset_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  escrow_id: string;
  amount_minor: string | number;
  currency: string;
  status: PurchaseStatus;
  shipped_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapPurchase(r: RawPurchase): CollectiblePurchaseRow {
  return {
    id: r.id,
    assetId: r.asset_id,
    buyerUserId: r.buyer_user_id,
    sellerUserId: r.seller_user_id,
    escrowId: r.escrow_id,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    status: r.status,
    shippedAt: r.shipped_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function assertCollectiblesEscrowEnabled(): void {
  if (!config.COLLECTIBLES_ESCROW_ENABLED) {
    throw new AppError(
      ErrorCode.COLLECTIBLES_ESCROW_DISABLED,
      "In-app collectible escrow is disabled — enable COLLECTIBLES_ESCROW_ENABLED after Corp B counsel review."
    );
  }
}

export function isSellerP2pAsset(asset: Asset): boolean {
  const meta = asset.metadata ?? {};
  return meta.listingType === "seller_p2p" && typeof meta.sellerUserId === "string";
}

export function sellerUserIdFromAsset(asset: Asset): string | null {
  if (!isSellerP2pAsset(asset)) return null;
  return asset.metadata!.sellerUserId as string;
}

async function loadPurchase(id: string): Promise<RawPurchase> {
  const row = await getDb().queryOne<RawPurchase>("SELECT * FROM collectible_purchases WHERE id = ?", [id]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Purchase not found");
  return row;
}

export async function findPurchaseByEscrowId(escrowId: string): Promise<CollectiblePurchaseRow | null> {
  const row = await getDb().queryOne<RawPurchase>("SELECT * FROM collectible_purchases WHERE escrow_id = ?", [escrowId]);
  return row ? mapPurchase(row) : null;
}

export async function getActivePurchaseForAsset(assetId: string): Promise<CollectiblePurchaseRow | null> {
  const row = await getDb().queryOne<RawPurchase>(
    `SELECT * FROM collectible_purchases
     WHERE asset_id = ? AND status IN ('escrow_held', 'shipped', 'disputed')
     ORDER BY created_at DESC LIMIT 1`,
    [assetId]
  );
  return row ? mapPurchase(row) : null;
}

export async function getPurchase(id: string): Promise<CollectiblePurchaseRow> {
  return mapPurchase(await loadPurchase(id));
}

export async function listPurchases(userId: string, limit = 50): Promise<CollectiblePurchaseRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<RawPurchase>(
    `SELECT * FROM collectible_purchases
     WHERE buyer_user_id = ? OR seller_user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [userId, userId, capped]
  );
  return rows.map(mapPurchase);
}

/** Buy a seller P2P listing — funds held in escrow; listing paused. Idempotent on idempotencyKey. */
export async function purchaseListing(input: {
  buyerUserId: string;
  assetId: string;
  idempotencyKey: string;
}): Promise<CollectiblePurchaseRow> {
  assertCollectiblesEscrowEnabled();
  if (await isAccountFrozen(input.buyerUserId)) {
    throw new AppError(ErrorCode.ACCOUNT_FROZEN, "This account is temporarily frozen pending a fraud review. Contact support.");
  }

  const db = getDb();
  const existing = await db.queryOne<RawPurchase>("SELECT * FROM collectible_purchases WHERE idempotency_key = ?", [
    input.idempotencyKey,
  ]);
  if (existing) return mapPurchase(existing);

  const asset = await requireAsset(input.assetId);
  const sellerId = sellerUserIdFromAsset(asset);
  if (!sellerId) {
    throw new AppError(ErrorCode.VALIDATION, "This asset is not a seller P2P listing — use marketplace order flow");
  }
  if (sellerId === input.buyerUserId) {
    throw new AppError(ErrorCode.VALIDATION, "Cannot buy your own listing");
  }
  if (asset.status !== "active") {
    throw new AppError(ErrorCode.CONFLICT, "Asset is not available for purchase");
  }

  const listing = await getCurrentListing(input.assetId);
  if (!listing || !isTradeable(listing.status)) {
    throw new AppError(ErrorCode.CONFLICT, "Listing is not available");
  }

  const open = await getActivePurchaseForAsset(input.assetId);
  if (open) throw new AppError(ErrorCode.CONFLICT, "This listing already has an open purchase");

  const amountMinor = BigInt(listing.priceMinor);
  const currency = listing.currency;
  if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Invalid listing price");

  const escrow = await hold({
    payerId: input.buyerUserId,
    payeeId: sellerId,
    amountMinor,
    currency,
    memo: `collectible:${input.assetId}`,
    idempotencyKey: `collectible:purchase:${input.idempotencyKey}`,
  });

  const id = uuidv4();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO collectible_purchases
       (id, asset_id, buyer_user_id, seller_user_id, escrow_id, amount_minor, currency, status, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'escrow_held', ?, ?, ?)`,
    [id, input.assetId, input.buyerUserId, sellerId, escrow.id, amountMinor.toString(), currency, input.idempotencyKey, now, now]
  );

  if (listing.status === "public") {
    await transitionListing(input.assetId, "paused", "collectibles-escrow");
  }

  await logAudit({
    userId: input.buyerUserId,
    action: "collectibles.purchase.hold",
    resource: id,
    details: { assetId: input.assetId, escrowId: escrow.id, amountMinor: amountMinor.toString(), currency },
  });

  return getPurchase(id);
}

/** Seller marks the slab shipped — buyer may then confirm receipt. */
export async function markShipped(purchaseId: string, sellerUserId: string): Promise<CollectiblePurchaseRow> {
  const row = await loadPurchase(purchaseId);
  if (row.seller_user_id !== sellerUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the seller can mark shipped");
  if (row.status === "shipped") return mapPurchase(row);
  if (row.status !== "escrow_held") {
    throw new AppError(ErrorCode.CONFLICT, `Purchase is ${row.status}, cannot mark shipped`);
  }

  const now = new Date().toISOString();
  await getDb().execute(
    "UPDATE collectible_purchases SET status = 'shipped', shipped_at = ?, updated_at = ? WHERE id = ?",
    [now, now, purchaseId]
  );
  await logAudit({
    userId: sellerUserId,
    action: "collectibles.purchase.shipped",
    resource: purchaseId,
    details: { assetId: row.asset_id },
  });
  return getPurchase(purchaseId);
}

/** Buyer confirms receipt — release escrow to seller and deliver the tokenized asset. */
export async function confirmReceipt(purchaseId: string, buyerUserId: string): Promise<CollectiblePurchaseRow> {
  const row = await loadPurchase(purchaseId);
  if (row.buyer_user_id !== buyerUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the buyer can confirm receipt");
  if (row.status === "completed") return mapPurchase(row);
  if (row.status !== "shipped") {
    throw new AppError(ErrorCode.CONFLICT, "Seller must mark shipped before you can confirm receipt");
  }

  await release(row.escrow_id, buyerUserId);
  await deliverFromTreasury(buyerUserId, row.asset_id, 1n, `collectible:deliver:${purchaseId}`);

  const now = new Date().toISOString();
  await getDb().execute(
    "UPDATE collectible_purchases SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
    [now, now, purchaseId]
  );

  const listing = await getCurrentListing(row.asset_id);
  if (listing && listing.status !== "delisted") {
    await transitionListing(row.asset_id, "delisted", "collectibles-escrow");
  }

  await logAudit({
    userId: buyerUserId,
    action: "collectibles.purchase.completed",
    resource: purchaseId,
    details: { assetId: row.asset_id, escrowId: row.escrow_id },
  });
  return getPurchase(purchaseId);
}

/** Seller refunds before shipment — buyer made whole, listing returns to public. */
export async function cancelBeforeShip(purchaseId: string, sellerUserId: string): Promise<CollectiblePurchaseRow> {
  const row = await loadPurchase(purchaseId);
  if (row.seller_user_id !== sellerUserId) throw new AppError(ErrorCode.FORBIDDEN, "Only the seller can cancel");
  if (row.status === "refunded") return mapPurchase(row);
  if (row.status !== "escrow_held") {
    throw new AppError(ErrorCode.CONFLICT, `Purchase is ${row.status}; refund only before shipment`);
  }

  await escrowRefund(row.escrow_id, sellerUserId);

  const now = new Date().toISOString();
  await getDb().execute(
    "UPDATE collectible_purchases SET status = 'refunded', updated_at = ? WHERE id = ?",
    [now, purchaseId]
  );

  const listing = await getCurrentListing(row.asset_id);
  if (listing?.status === "paused") {
    await transitionListing(row.asset_id, "public", "collectibles-escrow");
  }

  await logAudit({
    userId: sellerUserId,
    action: "collectibles.purchase.refunded",
    resource: purchaseId,
    details: { assetId: row.asset_id, escrowId: row.escrow_id },
  });
  return getPurchase(purchaseId);
}

/** Either party opens a dispute — funds stay in escrow. */
export async function disputePurchase(purchaseId: string, actorUserId: string, reason: string): Promise<CollectiblePurchaseRow> {
  const row = await loadPurchase(purchaseId);
  if (row.buyer_user_id !== actorUserId && row.seller_user_id !== actorUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, "Not a party to this purchase");
  }
  if (row.status === "disputed") return mapPurchase(row);
  if (row.status !== "escrow_held" && row.status !== "shipped") {
    throw new AppError(ErrorCode.CONFLICT, `Purchase is ${row.status}, cannot dispute`);
  }

  await openDispute(row.escrow_id, reason, actorUserId);

  const now = new Date().toISOString();
  await getDb().execute("UPDATE collectible_purchases SET status = 'disputed', updated_at = ? WHERE id = ?", [now, purchaseId]);

  await logAudit({
    userId: actorUserId,
    action: "collectibles.purchase.disputed",
    resource: purchaseId,
    details: { reason, escrowId: row.escrow_id },
  });
  return getPurchase(purchaseId);
}

/** After admin escrow resolution — deliver asset or relist. Idempotent on terminal purchase status. */
export async function syncFromEscrowResolution(escrowId: string, outcome: Resolution): Promise<CollectiblePurchaseRow | null> {
  const row = await getDb().queryOne<RawPurchase>("SELECT * FROM collectible_purchases WHERE escrow_id = ?", [escrowId]);
  if (!row) return null;
  if (row.status === "completed" || row.status === "refunded") return mapPurchase(row);
  if (row.status !== "disputed") return mapPurchase(row);

  const now = new Date().toISOString();
  if (outcome === "release") {
    await deliverFromTreasury(row.buyer_user_id, row.asset_id, 1n, `collectible:deliver:dispute:${row.id}`);
    await getDb().execute(
      "UPDATE collectible_purchases SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
      [now, now, row.id]
    );
    const listing = await getCurrentListing(row.asset_id);
    if (listing && listing.status !== "delisted") {
      await transitionListing(row.asset_id, "delisted", "collectibles-escrow");
    }
    await logAudit({
      userId: row.buyer_user_id,
      action: "collectibles.purchase.completed",
      resource: row.id,
      details: { via: "dispute_resolution", outcome },
    });
  } else {
    await getDb().execute("UPDATE collectible_purchases SET status = 'refunded', updated_at = ? WHERE id = ?", [now, row.id]);
    const listing = await getCurrentListing(row.asset_id);
    if (listing?.status === "paused") {
      await transitionListing(row.asset_id, "public", "collectibles-escrow");
    }
    await logAudit({
      userId: row.seller_user_id,
      action: "collectibles.purchase.refunded",
      resource: row.id,
      details: { via: "dispute_resolution", outcome },
    });
  }
  return getPurchase(row.id);
}

/** Block generic escrow release/refund when tied to an active collectible purchase. */
export async function assertEscrowNotPurchaseLinked(escrowId: string, action: "release" | "refund"): Promise<void> {
  const purchase = await findPurchaseByEscrowId(escrowId);
  if (!purchase) return;
  if (purchase.status === "completed" || purchase.status === "refunded") return;
  throw new AppError(
    ErrorCode.VALIDATION,
    `This escrow is tied to a collectible purchase — use the purchase ${action === "release" ? "confirm" : "cancel"} flow instead`
  );
}
