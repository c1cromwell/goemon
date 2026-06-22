/**
 * Phase 8 — Marketplace admin (RBAC-gated listing lifecycle + issuance).
 *
 * The listing lifecycle is a human compliance/admin gate: a reviewer creates the
 * asset, mints supply, creates the listing record, then walks it staging → soft
 * (≤1% users, enforced operationally) → public. Pause/delist preserves holdings.
 * Subscriptions are closed (funded) or refunded here. All mutations require role
 * compliance|admin; reads require any admin.
 *
 * Mounted at /api/admin (alongside adminRouter).
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { z } from "zod";
import { AppError, ErrorCode } from "../errors";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";
import * as tokenization from "../services/tokenizationService";
import * as listings from "../services/listingService";
import * as marketplace from "../services/marketplaceService";
import { declareCorporateAction, distributeDividend } from "../services/corporateActionService";
import { syncCollectiblesInventory, listExternalCollectibles } from "../services/collectiblesProvider";
import { fetchRwaCatalog } from "../services/rwaIssuerService";

export const marketplaceAdminRouter = Router();

function bigintFrom(v: string | number, field: string): bigint {
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, `${field} must be a non-negative integer`);
  }
}

// ---- Asset issuance -------------------------------------------------------

marketplaceAdminRouter.post(
  "/assets",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          kind: z.enum(["security", "collectible", "gaming"]),
          tokenStandard: z.enum(["erc3643", "hts"]),
          name: z.string().min(1),
          symbol: z.string().optional(),
          decimals: z.number().int().min(0).max(18).optional(),
          issuerUserId: z.string().optional(),
          metadata: z.record(z.unknown()).optional(),
          custodyAttestationUri: z.string().optional(),
          minTier: z.number().int().min(0).max(4).optional(),
          jurisdictionAllow: z.array(z.string()).optional(),
          holderCap: z.number().int().positive().optional(),
          initialSupply: z.union([z.string(), z.number()]).optional(),
        })
        .parse(req.body);

      const asset = await tokenization.createAsset({
        ...body,
        initialSupply: body.initialSupply !== undefined ? bigintFrom(body.initialSupply, "initialSupply") : undefined,
      });
      res.status(201).json({ assetId: asset.id, hederaTokenId: asset.hederaTokenId, totalSupply: asset.totalSupply.toString() });
    } catch (e) {
      next(e);
    }
  }
);

marketplaceAdminRouter.post(
  "/assets/:id/mint",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { qtyBase } = z.object({ qtyBase: z.union([z.string(), z.number()]) }).parse(req.body);
      await tokenization.mint(req.params.id!, bigintFrom(qtyBase, "qtyBase"));
      res.json({ minted: true });
    } catch (e) {
      next(e);
    }
  }
);

// ---- Listing lifecycle ----------------------------------------------------

marketplaceAdminRouter.post(
  "/listings",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          assetId: z.string().min(1),
          surface: z.enum(["invest", "collect"]),
          priceMinor: z.union([z.string(), z.number()]),
          currency: z.enum(["USD", "USDC"]).optional(),
          priceSource: z.enum(["nav", "spot", "orderbook", "issuer"]),
          ddOutcome: z.string().optional(),
        })
        .parse(req.body);
      const listing = await listings.createListing({
        assetId: body.assetId,
        surface: body.surface,
        priceMinor: bigintFrom(body.priceMinor, "priceMinor"),
        currency: body.currency,
        priceSource: body.priceSource,
        ddOutcome: body.ddOutcome,
        reviewer: req.adminId!,
      });
      res.status(201).json(listing);
    } catch (e) {
      next(e);
    }
  }
);

marketplaceAdminRouter.post(
  "/listings/:assetId/transition",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const { status } = z
        .object({ status: z.enum(["staging", "soft", "public", "paused", "delisted"]) })
        .parse(req.body);
      res.json(await listings.transitionListing(req.params.assetId!, status, req.adminId!));
    } catch (e) {
      next(e);
    }
  }
);

marketplaceAdminRouter.post(
  "/listings/:assetId/price",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ priceMinor: z.union([z.string(), z.number()]), source: z.enum(["nav", "spot", "orderbook", "issuer"]) })
        .parse(req.body);
      res.json(await listings.updatePrice(req.params.assetId!, bigintFrom(body.priceMinor, "priceMinor"), body.source, req.adminId!));
    } catch (e) {
      next(e);
    }
  }
);

// ---- Subscription settlement ----------------------------------------------

marketplaceAdminRouter.post(
  "/subscriptions/:orderId/close",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      await marketplace.closeSubscription(req.params.orderId!);
      res.json({ closed: true });
    } catch (e) {
      next(e);
    }
  }
);

marketplaceAdminRouter.post(
  "/subscriptions/:orderId/refund",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      await marketplace.refundSubscription(req.params.orderId!);
      res.json({ refunded: true });
    } catch (e) {
      next(e);
    }
  }
);

// Phase 18.6 — declare a corporate action (dividend/split) for an equity asset.
marketplaceAdminRouter.post(
  "/assets/:id/corporate-action",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({
          type: z.enum(["dividend", "split"]),
          amountPerUnitMinor: z.union([z.string(), z.number()]).optional(),
          currency: z.string().optional(),
          exDate: z.string().optional(),
          recordDate: z.string().optional(),
          payDate: z.string().optional(),
        })
        .parse(req.body);
      const ca = await declareCorporateAction({
        assetId: req.params.id!,
        type: body.type,
        amountPerUnitMinor: BigInt(body.amountPerUnitMinor ?? 0),
        currency: body.currency,
        exDate: body.exDate,
        recordDate: body.recordDate,
        payDate: body.payDate,
      });
      res.status(201).json({ corporateAction: ca });
    } catch (e) {
      next(e);
    }
  }
);

// Phase 18.6 — distribute a declared dividend to all current holders (idempotent per holder).
marketplaceAdminRouter.post(
  "/corporate-actions/:caId/distribute",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const result = await distributeDividend(req.params.caId!);
      res.json({ ...result, totalMinor: result.totalMinor.toString() });
    } catch (e) {
      next(e);
    }
  }
);

// Collectibles partner sync (Courtyard / Collector Crypt seam).
marketplaceAdminRouter.post(
  "/collectibles/sync",
  requireAdmin,
  requireRole("compliance", "admin"),
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const result = await syncCollectiblesInventory(req.adminId);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

marketplaceAdminRouter.get(
  "/collectibles/external",
  requireAdmin,
  async (req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      const listings = await listExternalCollectibles(provider);
      res.json({ listings });
    } catch (e) {
      next(e);
    }
  }
);

// RWA issuer catalog (Corp B — Ondo/Securitize/RealT).
marketplaceAdminRouter.get(
  "/rwa/catalog",
  requireAdmin,
  async (_req: AdminRequest, res: Response, next: NextFunction) => {
    try {
      const catalog = await fetchRwaCatalog();
      res.json({
        listings: catalog.map((l) => ({
          ...l,
          priceMinor: l.priceMinor.toString(),
        })),
      });
    } catch (e) {
      next(e);
    }
  }
);
