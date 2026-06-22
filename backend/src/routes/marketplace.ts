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
    res.json({ listings: await listings.listForUser(req.userId!, surface) });
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
