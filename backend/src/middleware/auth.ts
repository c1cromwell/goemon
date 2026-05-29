/**
 * Phase 1 — Auth middleware.
 *
 * requireAuth verifies a Bearer JWT (signed with config.JWT_SECRET) and sets
 * req.userId. Token minting for sessions lives in the auth routes (Phase 3);
 * this middleware only verifies session JWTs.
 *
 * NOTE: this is distinct from tokenFactory (RS256 scoped/exchange tokens used for
 * agent access). Session tokens are HS256 with the shared JWT_SECRET.
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export interface AuthRequest extends Request {
  userId?: string;
}

export function signSession(userId: string, ttlSeconds = 3600): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { algorithm: "HS256", expiresIn: ttlSeconds });
}

export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    next(new AppError(ErrorCode.UNAUTHENTICATED, "Missing Bearer token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as { sub?: string };
    if (!payload.sub) {
      next(new AppError(ErrorCode.UNAUTHENTICATED, "Token missing subject"));
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    next(new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired token"));
  }
}

export function getClientIp(req: Request): string {
  // Use Express's req.ip which respects app.set("trust proxy", N). When behind a
  // trusted reverse proxy this gives the real client IP without allowing spoofing
  // via a raw X-Forwarded-For header (M-1). Falls back to socket address.
  return (req as Request & { ip?: string }).ip ?? req.socket.remoteAddress ?? "unknown";
}
