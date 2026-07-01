/**
 * Pre-launch waitlist — capture early-access emails before Phase A opens.
 *
 *   POST /api/waitlist            { email, source? }   (public) → { ok: true }
 *   GET  /api/waitlist/admin                            (RBAC)   → { count, recent[] }
 *
 * No money, no auth on the POST (it's a public landing form). Idempotent on email:
 * a repeat submit is a no-op success, so the UI never leaks whether an address is
 * already on the list. Rate-limited by the global apiLimiter.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { requireAdmin, requireRole } from "../middleware/rbac";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../observability/logger";

export const waitlistRouter = Router();

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  source: z.string().trim().max(64).optional(),
});

waitlistRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, source } = emailSchema.parse(req.body);
    const db = getDb();
    const existing = await db.queryOne<{ id: string }>("SELECT id FROM waitlist_signups WHERE email = ?", [email]);
    if (!existing) {
      await db.execute(
        "INSERT INTO waitlist_signups (id, email, source, created_at) VALUES (?, ?, ?, ?)",
        [uuidv4(), email, source ?? "waitlist", new Date().toISOString()]
      );
      logger.info({ source: source ?? "waitlist" }, "waitlist signup");
    }
    // Same response whether new or duplicate — don't leak membership.
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return next(new AppError(ErrorCode.VALIDATION, "Please enter a valid email address."));
    next(e);
  }
});

waitlistRouter.get("/admin", requireAdmin, requireRole("admin", "ceo", "compliance"), async (_req, res, next) => {
  try {
    const db = getDb();
    const row = await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM waitlist_signups");
    const recent = await db.query<{ email: string; source: string | null; created_at: string }>(
      "SELECT email, source, created_at FROM waitlist_signups ORDER BY created_at DESC LIMIT 50"
    );
    res.json({ count: Number(row?.n ?? 0), recent });
  } catch (e) {
    next(e);
  }
});
