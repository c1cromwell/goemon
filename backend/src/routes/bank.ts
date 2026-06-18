/**
 * Phase 19 Stage-1 — full-bank rails API (customer surface). Mounted at /api/bank.
 *
 *   POST /api/bank/deposit              { amountMinor, currency? }            (Idempotency-Key)
 *   POST /api/bank/withdraw             { amountMinor, currency?, method?, destination? } (Idempotency-Key)
 *   GET  /api/bank/transfers
 *   GET  /api/bank/statement?from=&to=&currency=
 *   GET  /api/bank/accounts
 *   POST /api/bank/accounts             { label?, type?, last4, routing? }
 *
 * Money-moving routes require an Idempotency-Key (idempotency() middleware). All gated by
 * BANK_RAILS_ENABLED via the service (BANK_RAILS_DISABLED when off). Requires Tier 2.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { requireTier } from "../middleware/requireTier";
import { idempotency } from "../middleware/idempotency";
import { AppError, ErrorCode } from "../errors";
import { deposit, withdraw, listTransfers, linkBankAccount, listBankAccounts } from "../services/bankRailService";
import { getStatement } from "../services/statementService";

export const bankRouter = Router();

function amount(v: string | number): bigint {
  try {
    const n = BigInt(v);
    if (n <= 0n) throw new Error();
    return n;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "amountMinor must be a positive integer (minor units)");
  }
}

bankRouter.post("/deposit", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ amountMinor: z.union([z.string(), z.number()]), currency: z.string().optional() }).parse(req.body);
    const result = await deposit({ userId: req.userId!, amountMinor: amount(body.amountMinor), currency: body.currency, idempotencyKey: req.header("Idempotency-Key")! });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

bankRouter.post("/withdraw", requireAuth, requireTier(2), idempotency(), async (req: AuthRequest, res, next) => {
  try {
    const body = z
      .object({
        amountMinor: z.union([z.string(), z.number()]),
        currency: z.string().optional(),
        method: z.enum(["ach", "wire", "instant"]).optional(),
        destination: z.string().optional(),
      })
      .parse(req.body);
    const result = await withdraw({
      userId: req.userId!,
      amountMinor: amount(body.amountMinor),
      currency: body.currency,
      method: body.method,
      destination: body.destination,
      idempotencyKey: req.header("Idempotency-Key")!,
      channel: "bank",
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

bankRouter.get("/transfers", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ transfers: await listTransfers(req.userId!) });
  } catch (e) {
    next(e);
  }
});

bankRouter.get("/statement", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const q = z.object({ from: z.string(), to: z.string(), currency: z.string().optional() }).parse(req.query);
    res.json(await getStatement(req.userId!, q.from, q.to, q.currency ?? "USD"));
  } catch (e) {
    next(e);
  }
});

bankRouter.get("/accounts", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json({ accounts: await listBankAccounts(req.userId!) });
  } catch (e) {
    next(e);
  }
});

bankRouter.post("/accounts", requireAuth, requireTier(2), async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ label: z.string().optional(), type: z.enum(["checking", "savings"]).optional(), last4: z.string(), routing: z.string().optional() }).parse(req.body);
    res.status(201).json(await linkBankAccount({ userId: req.userId!, label: body.label, type: body.type, last4: body.last4, routing: body.routing }));
  } catch (e) {
    next(e);
  }
});
