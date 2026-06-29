/**
 * Seller collectible submissions — slab cert verify + P2P listing intake.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import * as sellerCollectibles from "../services/sellerCollectibleService";
import * as collectiblePurchases from "../services/collectiblePurchaseService";
import { getCollectiblesGoLiveStatus } from "../services/collectiblesGoLiveService";

export const collectiblesRouter = Router();

collectiblesRouter.get("/go-live-status", async (_req, res, next) => {
  try {
    res.json(await getCollectiblesGoLiveStatus());
  } catch (e) {
    next(e);
  }
});

const graderSchema = z.enum(["psa", "bgs", "sgc", "cgc"]);
const categorySchema = z.enum(["sports", "pokemon"]);

collectiblesRouter.post("/verify-cert", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      grader: graderSchema,
      certNumber: z.string().min(1),
    }).parse(req.body);
    const result = await sellerCollectibles.previewCert(body.grader, body.certNumber);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.post("/submissions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      category: categorySchema,
      grader: graderSchema,
      certNumber: z.string().min(1),
      askUsdcMicro: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
      title: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      imageUrls: z.array(z.string().url()).max(5).optional(),
      runAiPreGrade: z.boolean().optional(),
    }).parse(req.body);

    const submission = await sellerCollectibles.submitSellerListing({
      sellerUserId: req.userId!,
      category: body.category,
      grader: body.grader,
      certNumber: body.certNumber,
      askUsdcMicro: BigInt(body.askUsdcMicro),
      title: body.title,
      description: body.description,
      imageUrls: body.imageUrls,
      runAiPreGrade: body.runAiPreGrade,
    });
    res.status(201).json({ submission });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.get("/submissions/mine", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const submissions = await sellerCollectibles.listMySubmissions(req.userId!);
    res.json({ submissions });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.get("/submissions/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const submission = await sellerCollectibles.getSubmission(req.params.id!);
    if (submission.sellerUserId !== req.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "Not your submission");
    }
    res.json({ submission });
  } catch (e) {
    next(e);
  }
});

// --- In-app escrow purchase (seller P2P listings) ---

collectiblesRouter.post("/purchase", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ assetId: z.string().min(1) }).parse(req.body);
    const purchase = await collectiblePurchases.purchaseListing({
      buyerUserId: req.userId!,
      assetId: body.assetId,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json({ purchase });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.get("/purchases", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const purchases = await collectiblePurchases.listPurchases(req.userId!, limit);
    res.json({ purchases });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.get("/purchases/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const purchase = await collectiblePurchases.getPurchase(req.params.id!);
    if (purchase.buyerUserId !== req.userId && purchase.sellerUserId !== req.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "Not a party to this purchase");
    }
    res.json({ purchase });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.post("/purchases/:id/ship", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const purchase = await collectiblePurchases.markShipped(req.params.id!, req.userId!);
    res.json({ purchase });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.post("/purchases/:id/confirm", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const purchase = await collectiblePurchases.confirmReceipt(req.params.id!, req.userId!);
    res.json({ purchase });
  } catch (e) {
    next(e);
  }
});

collectiblesRouter.post("/purchases/:id/cancel", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const purchase = await collectiblePurchases.cancelBeforeShip(req.params.id!, req.userId!);
    res.json({ purchase });
  } catch (e) {
    next(e);
  }
});

const disputeSchema = z.object({ reason: z.string().min(1).max(500) });

collectiblesRouter.post("/purchases/:id/dispute", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = disputeSchema.parse(req.body);
    const purchase = await collectiblePurchases.disputePurchase(req.params.id!, req.userId!, body.reason);
    res.json({ purchase });
  } catch (e) {
    next(e);
  }
});
