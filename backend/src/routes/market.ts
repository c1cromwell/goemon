/**
 * Secondary market — order book (Phase 29 P6).
 *
 *   GET  /api/market/assets            → tradeable assets (your holdings + assets with a book)
 *   GET  /api/market/book/:assetId     → aggregated bids/asks
 *   GET  /api/market/trades/:assetId   → recent trades
 *   POST /api/market/orders            → place a limit order (Idempotency-Key) → { order, fills }
 *   GET  /api/market/orders            → my orders
 *   POST /api/market/orders/:id/cancel → cancel + refund escrow
 *
 * Gated by SECONDARY_MARKET_ENABLED via the service.
 */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import {
  placeOrder, cancelOrder, getBook, listMyOrders, listTrades, type Order,
} from "../services/secondaryMarketService";
import { getPortfolio } from "../services/marketplaceService";
import { getAsset } from "../services/tokenizationService";
import { getDb } from "../db";

export const marketRouter = Router();

function bigintStr(field: string) {
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    try { const n = BigInt(v); if (n < 0n) throw new Error(); return n; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be a non-negative integer` }); return z.NEVER; }
  });
}
const orderView = (o: Order) => ({
  id: o.id, assetId: o.assetId, side: o.side, qtyTotal: o.qtyTotal.toString(), qtyRemaining: o.qtyRemaining.toString(),
  limitPriceMinor: o.limitPriceMinor.toString(), currency: o.currency, status: o.status, createdAt: o.createdAt,
});

marketRouter.get("/assets", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ids = new Set<string>();
    const portfolio = await getPortfolio(req.userId!);
    portfolio.holdings.forEach((h) => ids.add(h.assetId));
    const booked = await getDb().query<{ asset_id: string }>("SELECT DISTINCT asset_id FROM trade_orders WHERE status = 'open'");
    booked.forEach((r) => ids.add(r.asset_id));
    const assets = (await Promise.all([...ids].map((id) => getAsset(id)))).filter(Boolean);
    res.json({ assets: assets.map((a) => ({ id: a!.id, name: a!.name, symbol: a!.symbol, kind: a!.kind })) });
  } catch (e) { next(e); }
});

marketRouter.get("/book/:assetId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await getBook(req.params.assetId!)); } catch (e) { next(e); }
});

marketRouter.get("/trades/:assetId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json({ trades: await listTrades(req.params.assetId!) }); } catch (e) { next(e); }
});

const placeSchema = z.object({
  assetId: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  qty: bigintStr("qty"),
  limitPriceMinor: bigintStr("limitPriceMinor"),
  currency: z.string().optional(),
});

marketRouter.post("/orders", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = placeSchema.parse(req.body);
    const key = (req.header("Idempotency-Key") ?? `${body.assetId}:${Date.now()}`).slice(0, 120);
    const result = await placeOrder({ userId: req.userId!, idempotencyKey: key, ...body });
    res.status(201).json({ order: orderView(result.order), fills: result.fills });
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, e.issues[0]?.message ?? "Invalid request"));
    next(e);
  }
});

marketRouter.get("/orders", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json({ orders: (await listMyOrders(req.userId!)).map(orderView) }); } catch (e) { next(e); }
});

marketRouter.post("/orders/:id/cancel", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(orderView(await cancelOrder(req.params.id!, req.userId!))); } catch (e) { next(e); }
});
