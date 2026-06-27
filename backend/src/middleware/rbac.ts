/**
 * Phase 5A — RBAC for the admin console (the Phase 11 RBAC core, pulled forward).
 *
 * Admin identities live in the `admins` table (id, email, password_hash, role).
 * Admin sessions use a JWT signed with ADMIN_JWT_SECRET (distinct from the user
 * JWT_SECRET; falls back to JWT_SECRET in dev only). The `kind: "admin"` claim keeps
 * admin tokens from being interchangeable with user session tokens.
 *
 * requireAdmin   — any authenticated admin.
 * requireRole(…) — admin whose role is in the allow-list (e.g. compliance/admin).
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export type AdminRole = "support" | "compliance" | "admin" | "ceo" | "chief_of_staff";

export interface AdminRequest extends Request {
  adminId?: string;
  adminRole?: AdminRole;
}

function adminSecret(): string {
  return config.ADMIN_JWT_SECRET ?? config.JWT_SECRET;
}

export function signAdminSession(adminId: string, role: AdminRole, ttlSeconds = 3600): string {
  return jwt.sign({ sub: adminId, role, kind: "admin" }, adminSecret(), {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
  });
}

export function requireAdmin(req: AdminRequest, _res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    next(new AppError(ErrorCode.UNAUTHENTICATED, "Missing admin Bearer token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, adminSecret(), { algorithms: ["HS256"] }) as {
      sub?: string;
      role?: AdminRole;
      kind?: string;
    };
    if (payload.kind !== "admin" || !payload.sub || !payload.role) {
      next(new AppError(ErrorCode.FORBIDDEN, "Not an admin token"));
      return;
    }
    req.adminId = payload.sub;
    req.adminRole = payload.role;
    next();
  } catch {
    next(new AppError(ErrorCode.UNAUTHENTICATED, "Invalid or expired admin token"));
  }
}

/** Mount AFTER requireAdmin. Rejects admins whose role is not in `roles`. */
export function requireRole(...roles: AdminRole[]) {
  return (req: AdminRequest, _res: Response, next: NextFunction): void => {
    if (!req.adminRole) {
      next(new AppError(ErrorCode.UNAUTHENTICATED, "Admin authentication required"));
      return;
    }
    if (!roles.includes(req.adminRole)) {
      next(new AppError(ErrorCode.FORBIDDEN, `Requires role: ${roles.join(" or ")}`));
      return;
    }
    next();
  };
}
