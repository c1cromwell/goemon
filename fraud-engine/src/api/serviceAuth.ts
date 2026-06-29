/**
 * Service-to-service auth for the engine's /v1 surface. Goeman presents a shared
 * bearer (FRAUD_ENGINE_API_KEY); compared in constant time. This is not user
 * RBAC — the engine has no users, only a trusted caller (Goeman / the fraud team's
 * tooling).
 */

import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, config.FRAUD_ENGINE_API_KEY)) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid or missing service token" } });
    return;
  }
  next();
}
