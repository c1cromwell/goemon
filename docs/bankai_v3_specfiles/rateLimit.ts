/**
 * Phase 1 — Rate limiting & auth lockout.
 *
 *  - authLimiter: enforces the PRD rule "N failed auth attempts -> lockout for M
 *    minutes" using the auth_failures table (durable, survives restarts).
 *  - apiLimiter: a simple in-memory sliding-window limiter per user/IP. For a
 *    single-node prototype this is fine; production should back this with Redis
 *    (REDIS_URL) so limits are shared across instances.
 *
 * recordAuthFailure() / clearAuthFailures() are called by the auth routes
 * (Phase 3) around login attempts.
 */

import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { getClientIp, type AuthRequest } from "./auth";

// --- Auth lockout (durable, DB-backed) ------------------------------------

export async function recordAuthFailure(identifier: string, ip: string): Promise<void> {
  await getDb().execute("INSERT INTO auth_failures (id, identifier, ip, created_at) VALUES (?, ?, ?, ?)", [
    uuidv4(),
    identifier.toLowerCase(),
    ip,
    new Date().toISOString(),
  ]);
}

export async function clearAuthFailures(identifier: string): Promise<void> {
  await getDb().execute("DELETE FROM auth_failures WHERE identifier = ?", [identifier.toLowerCase()]);
}

async function failureCount(identifier: string, ip: string): Promise<number> {
  const sinceIso = new Date(Date.now() - config.AUTH_LOCKOUT_MINUTES * 60_000).toISOString();
  const row = await getDb().queryOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM auth_failures WHERE (identifier = ? OR ip = ?) AND created_at > ?",
    [identifier.toLowerCase(), ip, sinceIso]
  );
  return Number(row?.c ?? 0);
}

/**
 * Mount BEFORE the login handler. The handler should read req.body for the
 * identifier (email) and call recordAuthFailure/clearAuthFailures itself.
 * This middleware blocks the attempt early if already locked out.
 */
export function authLimiter() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const identifier = String(req.body?.email ?? req.body?.identifier ?? "").toLowerCase();
    const ip = getClientIp(req);
    const count = await failureCount(identifier, ip);
    if (count >= config.AUTH_MAX_FAILURES) {
      next(
        new AppError(
          ErrorCode.ACCOUNT_LOCKED,
          `Too many failed attempts. Try again in up to ${config.AUTH_LOCKOUT_MINUTES} minutes.`
        )
      );
      return;
    }
    next();
  };
}

// --- Generic API limiter (in-memory sliding window) -----------------------

interface Bucket {
  hits: number[];
}
const buckets = new Map<string, Bucket>();

export function apiLimiter(perMinute = config.API_RATE_LIMIT_PER_MIN) {
  const windowMs = 60_000;
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    const key = req.userId ?? getClientIp(req) ?? "anon";
    const now = Date.now();
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length >= perMinute) {
      buckets.set(key, bucket);
      next(new AppError(ErrorCode.RATE_LIMITED, "Rate limit exceeded; slow down."));
      return;
    }
    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}
