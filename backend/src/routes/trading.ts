/**
 * Phase 17 — Trading routes (thin REST over the isolated trading seam).
 *
 * GET  /api/trading/instruments — tradable instruments + simulated marks
 * GET  /api/trading/quotes       — live quotes (source/as-of/staleness; CQRS)
 * GET  /api/trading/account      — user's trading enrolment (options level)
 * POST /api/trading/orders       — place an order (idempotent; HOT PATH, no ledger)
 * GET  /api/trading/orders       — the user's recent orders
 * GET  /api/trading/positions    — the user's ledger-derived positions
 *
 * Order placement returns 'accepted' immediately; the async settlement worker
 * settles it (clients poll GET orders/positions). When TRADING_ENABLED is off the
 * service throws TRADING_DISABLED (503) — surfaced here unchanged.
 */

import { Router } from "express";
import { z } from "zod";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { idempotency } from "../middleware/idempotency";
import { getDb } from "../db";
import { placeOrder, getOrders, getPositions, getTradingAccount } from "../services/tradingService";
import { getQuotes } from "../services/marketDataService";

export const tradingRouter = Router();

tradingRouter.get("/instruments", requireAuth, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await getDb().query<{
      symbol: string;
      kind: string;
      display_name: string;
      currency: string;
      last_price_minor: string | number;
      min_options_level: number;
    }>("SELECT symbol, kind, display_name, currency, last_price_minor, min_options_level FROM instruments WHERE status = 'active' ORDER BY symbol");
    res.json(
      rows.map((r) => ({
        symbol: r.symbol,
        kind: r.kind,
        displayName: r.display_name,
        currency: r.currency,
        lastPriceMinor: BigInt(r.last_price_minor).toString(),
        minOptionsLevel: r.min_options_level,
      }))
    );
  } catch (e) {
    next(e);
  }
});

tradingRouter.get("/quotes", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const symbolsParam = req.query.symbols;
    const symbols =
      typeof symbolsParam === "string" && symbolsParam.length > 0
        ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const quotes = await getQuotes(symbols);
    res.json(
      quotes.map((q) => ({
        symbol: q.symbol,
        bidMinor: q.bidMinor.toString(),
        askMinor: q.askMinor.toString(),
        lastMinor: q.lastMinor.toString(),
        source: q.source,
        asOf: q.asOf,
        stale: q.stale,
      }))
    );
  } catch (e) {
    next(e);
  }
});

tradingRouter.get("/account", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getTradingAccount(req.userId!));
  } catch (e) {
    next(e);
  }
});

const placeOrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop", "stop_limit"]).default("market"),
  qtyBase: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  limitPriceMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
  stopPriceMinor: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
});

tradingRouter.post("/orders", requireAuth, idempotency(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = placeOrderSchema.parse(req.body);
    const order = await placeOrder({
      userId: req.userId!,
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      qtyBase: BigInt(body.qtyBase),
      limitPriceMinor: body.limitPriceMinor != null ? BigInt(body.limitPriceMinor) : null,
      stopPriceMinor: body.stopPriceMinor != null ? BigInt(body.stopPriceMinor) : null,
      idempotencyKey: req.header("Idempotency-Key")!,
    });
    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

tradingRouter.get("/orders", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json(await getOrders(req.userId!, limit));
  } catch (e) {
    next(e);
  }
});

tradingRouter.get("/positions", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getPositions(req.userId!));
  } catch (e) {
    next(e);
  }
});
