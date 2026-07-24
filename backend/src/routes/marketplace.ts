/**
 * Phase 8 — Marketplace API (customer surface).
 *
 * Two surfaces under one mount: Invest (securities-style RWAs) and Collect
 * (collectibles/gaming). Holdings derive from the ledger; money-mutating routes
 * require an Idempotency-Key. The clean shapes here (eligibility flags, a quote
 * step with full fee disclosure before execution) are what the Phase 9 "Quiet
 * Premium" UI renders.
 *
 *   GET  /api/marketplace/listings?surface=invest|collect
 *   GET  /api/marketplace/assets/:id
 *   GET  /api/marketplace/portfolio
 *   POST /api/marketplace/quote                 { assetId, side, qtyBase }
 *   POST /api/marketplace/assets/:id/subscribe  { qtyBase }        (Idempotency-Key)
 *   POST /api/marketplace/orders                { assetId, side, qtyBase } (Idempotency-Key)
 *   POST /api/marketplace/assets/:id/transfer   { toUserId, qtyBase }      (Idempotency-Key)
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import * as marketplace from "../services/marketplaceService";
import * as listings from "../services/listingService";
import { getAsset } from "../services/tokenizationService";
import { getCurrentListing } from "../services/listingService";
import { redeem, backingAttestation } from "../services/redemptionService";
import { config } from "../config";
import {
  getActivePurchaseForAsset,
  isSellerP2pAsset,
} from "../services/collectiblePurchaseService";
import { getMetrics, listMetricsForSurface } from "../services/assetMetricsService";
import { getIntel } from "../services/collectibleIntelService";
import * as watchlist from "../services/watchlistService";
import * as assetViews from "../services/assetViewService";

export const marketplaceRouter = Router();

/** Parse a positive integer base-unit quantity (bigint). */
function qty(v: string | number): bigint {
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "qtyBase must be an integer (base units)");
  }
  if (n <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be positive");
  return n;
}

marketplaceRouter.get("/listings", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const surface = z.enum(["invest", "collect"]).optional().parse(req.query.surface);
    const rows = await listings.listForUser(req.userId!, surface);
    // Attach compact per-card metrics in one batched pass (investors, saves, change%, yield).
    const metrics = await listMetricsForSurface(rows.map((r) => r.assetId), req.userId!);
    res.json({ listings: rows.map((r) => ({ ...r, metrics: metrics[r.assetId] ?? null })) });
  } catch (e) {
    next(e);
  }
});

// --- Phase 30 asset intelligence ---------------------------------------------

marketplaceRouter.get("/watchlist", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ids = await watchlist.listAssetIds(req.userId!);
    // Return them as listing views (with metrics) filtered to the saved set.
    const rows = (await listings.listForUser(req.userId!)).filter((r) => ids.includes(r.assetId));
    const metrics = await listMetricsForSurface(rows.map((r) => r.assetId), req.userId!);
    res.json({ assetIds: ids, listings: rows.map((r) => ({ ...r, metrics: metrics[r.assetId] ?? null })) });
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.get("/assets/:id/metrics", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    // Best-effort view record — never blocks the metrics read.
    void assetViews.recordView(req.userId!, req.params.id!).catch(() => undefined);
    const m = await getMetrics(req.params.id!, req.userId!);
    if (!m) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
    res.json(m);
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.get("/assets/:id/collectible-intel", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const asset = await getAsset(req.params.id!);
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
    if (asset.kind !== "collectible") throw new AppError(ErrorCode.VALIDATION, "Not a collectible");
    const listing = await getCurrentListing(asset.id);
    const priceMinor = listing ? BigInt(listing.priceMinor) : null;
    res.json(await getIntel(asset, priceMinor));
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.post("/assets/:id/watch", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await watchlist.add(req.userId!, req.params.id!);
    res.json({ watched: true });
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.delete("/assets/:id/watch", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await watchlist.remove(req.userId!, req.params.id!);
    res.json({ watched: false });
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.get("/portfolio", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await marketplace.getPortfolio(req.userId!));
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.get("/assets/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const asset = await getAsset(req.params.id!);
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
    const listing = await getCurrentListing(asset.id);
    const activePurchase = await getActivePurchaseForAsset(asset.id);
    const sellerP2p = isSellerP2pAsset(asset);
    res.json({
      asset: {
        id: asset.id,
        name: asset.name,
        symbol: asset.symbol,
        kind: asset.kind,
        tokenStandard: asset.tokenStandard,
        decimals: asset.decimals,
        minTier: asset.minTier,
        isSecurity: asset.isSecurity,
        metadata: asset.metadata,
        totalSupply: asset.totalSupply.toString(),
        status: asset.status,
      },
      listing,
      purchaseMode: sellerP2p ? "escrow" : "instant",
      collectiblesEscrowEnabled: config.COLLECTIBLES_ESCROW_ENABLED,
      activePurchase: activePurchase
        ? {
            id: activePurchase.id,
            status: activePurchase.status,
            buyerUserId: activePurchase.buyerUserId,
            sellerUserId: activePurchase.sellerUserId,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.post("/quote", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({ assetId: z.string().min(1), side: z.enum(["buy", "sell", "subscribe"]), qtyBase: z.union([z.string(), z.number()]) })
      .parse(req.body);
    res.json(await marketplace.quote(body.assetId, body.side, qty(body.qtyBase)));
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.post("/assets/:id/subscribe", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const { qtyBase } = z.object({ qtyBase: z.union([z.string(), z.number()]) }).parse(req.body);
    const key = req.header("Idempotency-Key")!;
    const result = await marketplace.subscribe(req.userId!, req.params.id!, qty(qtyBase), key);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.post("/orders", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({ assetId: z.string().min(1), side: z.enum(["buy", "sell"]), qtyBase: z.union([z.string(), z.number()]) })
      .parse(req.body);
    const key = req.header("Idempotency-Key")!;
    const result = await marketplace.placeOrder(req.userId!, body.assetId, body.side, qty(body.qtyBase), key);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.post("/assets/:id/transfer", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ toUserId: z.string().min(1), qtyBase: z.union([z.string(), z.number()]) }).parse(req.body);
    const key = req.header("Idempotency-Key")!;
    const result = await marketplace.transferAsset(req.userId!, body.toUserId, req.params.id!, qty(body.qtyBase), key);
    res.status(201).json({ transferred: true, ...result });
  } catch (e) {
    next(e);
  }
});

// Phase 18.6 — tokenized equities: on-chain redemption + 1:1 backing attestation.
marketplaceRouter.post("/assets/:id/redeem", requireAuth, idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ qtyBase: z.union([z.string(), z.number()]) }).parse(req.body);
    const result = await redeem({
      userId: req.userId!,
      assetId: req.params.id!,
      qtyBase: qty(body.qtyBase),
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json({
      redeemed: true,
      redemptionId: result.redemptionId,
      journalId: result.journalId,
      proceedsMinor: result.proceedsMinor.toString(),
      externalRef: result.externalRef,
    });
  } catch (e) {
    next(e);
  }
});

marketplaceRouter.get("/assets/:id/backing", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const a = await backingAttestation(req.params.id!);
    res.json({
      symbol: a.symbol,
      sharesCustodied: a.sharesCustodied.toString(),
      tokenSupply: a.tokenSupply.toString(),
      backedOneToOne: a.backedOneToOne,
      custodian: a.custodian,
      asOf: a.asOf,
    });
  } catch (e) {
    next(e);
  }
});
