/**
 * Phase 0 — Idempotency.
 *
 * Money-mutating endpoints accept an `Idempotency-Key` header. The first request
 * with a given (key, user) stores its response; replays return the stored response
 * verbatim. Reuse of a key with a DIFFERENT request body returns 409 (the client
 * is misusing the key). This makes retries safe — a network retry can never
 * double-execute a transfer.
 *
 * Usage: mount on money routes AFTER requireAuth, e.g.
 *   router.post("/transfer", requireAuth, idempotency(), handler)
 */

import crypto from "crypto";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";

function hashBody(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

export function idempotency() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header("Idempotency-Key");
    if (!key) {
      next(new AppError(ErrorCode.VALIDATION, "Idempotency-Key header is required for this operation"));
      return;
    }
    const userId = req.userId ?? "anonymous";
    const requestHash = hashBody(req.body);
    const db = getDb();

    const existing = await db.queryOne<{ request_hash: string; response: string | null; http_status: number | null }>(
      "SELECT request_hash, response, http_status FROM idempotency_keys WHERE key = ? AND user_id = ?",
      [key, userId]
    );

    if (existing) {
      if (existing.request_hash !== requestHash) {
        next(new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, "Idempotency-Key reused with a different request body"));
        return;
      }
      // Replay: return the stored response.
      res.status(existing.http_status ?? 200);
      res.setHeader("Idempotency-Replayed", "true");
      res.json(existing.response ? JSON.parse(existing.response) : {});
      return;
    }

    // Capture the response body so we can persist it once the handler responds.
    const originalJson = res.json.bind(res);
    let captured: unknown;
    res.json = ((body: unknown) => {
      captured = body;
      return originalJson(body);
    }) as Response["json"];

    res.on("finish", () => {
      // Only persist successful (2xx) responses; failures should be retryable.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void db
          .execute(
            "INSERT INTO idempotency_keys (key, user_id, request_hash, response, http_status) VALUES (?, ?, ?, ?, ?)",
            [key, userId, requestHash, JSON.stringify(captured ?? {}), res.statusCode]
          )
          .catch(() => {
            /* best-effort; a duplicate insert race is harmless */
          });
      }
    });

    next();
  };
}
