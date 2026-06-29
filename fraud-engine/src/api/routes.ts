/**
 * HTTP API. All /v1 routes require the service bearer; /health and /metrics are
 * open for probes/scraping. Handlers are thin — they validate, call a service,
 * and serialize (bigints → strings).
 */

import { Router as ExpressRouter, type Request, type Response } from "express";
import type { Context } from "../context";
import { parseEvent, SCHEMA_VERSION } from "../bus/schemaRegistry";
import { requireServiceAuth } from "./serviceAuth";
import { getGoemanClient } from "../remediation/goemanClient";
import type { Decision } from "../types";
import { logger } from "../observability/logger";

function asyncH(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e) => {
      logger.error({ err: (e as Error).message }, "route handler failed");
      res.status(400).json({ error: { code: "BAD_REQUEST", message: (e as Error).message } });
    });
  };
}

export function buildRoutes(ctx: Context): ExpressRouter {
  const r = ExpressRouter();
  r.use("/v1", requireServiceAuth);

  // --- Ingest --------------------------------------------------------------
  r.post(
    "/v1/events",
    asyncH(async (req, res) => {
      const schemaVersion = (req.body?.schemaVersion as string) ?? SCHEMA_VERSION;
      const mode = (req.query.mode as string) ?? req.body?.mode ?? "score";
      const { event } = parseEvent({ ...req.body, mode }, schemaVersion);
      const decision = await ctx.engine.process(event);
      if (event.mode === "async") {
        res.status(202).json({ accepted: true, decisionId: decision.decisionId, action: decision.action });
      } else {
        res.status(200).json(serializeDecision(decision));
      }
    })
  );

  // --- Decisions -----------------------------------------------------------
  r.get(
    "/v1/decisions",
    asyncH(async (req, res) => {
      const userId = req.query.userId as string | undefined;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const rows = userId
        ? await ctx.db.query("SELECT * FROM decisions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, limit])
        : await ctx.db.query("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?", [limit]);
      res.json({ decisions: rows.map(serializeDecisionRow) });
    })
  );

  // --- Cases ---------------------------------------------------------------
  r.get(
    "/v1/cases",
    asyncH(async (req, res) => {
      const status = req.query.status as ("open" | "assigned" | "resolved" | "dismissed") | undefined;
      res.json({ cases: await ctx.cases.list(status) });
    })
  );

  r.get(
    "/v1/cases/:id",
    asyncH(async (req, res) => {
      const c = await ctx.cases.get(req.params.id!);
      if (!c) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "case not found" } });
        return;
      }
      res.json({ case: c, events: await ctx.cases.events(c.id) });
    })
  );

  r.post(
    "/v1/cases/:id/resolve",
    asyncH(async (req, res) => {
      const status = req.body?.status === "dismissed" ? "dismissed" : "resolved";
      await ctx.cases.resolve(req.params.id!, req.body?.actor ?? "analyst", status, req.body?.note);
      res.json({ ok: true });
    })
  );

  // Analyst action on a case: freeze/unfreeze the user (calls Goeman back).
  r.post(
    "/v1/cases/:id/action",
    asyncH(async (req, res) => {
      const c = await ctx.cases.get(req.params.id!);
      if (!c) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "case not found" } });
        return;
      }
      const action = req.body?.action as string;
      const actor = (req.body?.actor as string) ?? "analyst";
      if (action === "freeze") {
        await ctx.cases.recordAction(c.id, "freeze_requested", actor, req.body?.reason);
        await getGoemanClient().freeze({ userId: c.userId, reason: req.body?.reason ?? "analyst freeze", decisionId: c.decisionId ?? c.id });
      } else if (action === "unfreeze") {
        await ctx.cases.recordAction(c.id, "unfreeze_requested", actor, req.body?.reason);
        await getGoemanClient().unfreeze({ userId: c.userId, reason: req.body?.reason ?? "analyst unfreeze", decisionId: c.decisionId ?? c.id });
      } else if (action === "dismiss") {
        await ctx.cases.resolve(c.id, actor, "dismissed", req.body?.reason);
      } else {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "unknown action" } });
        return;
      }
      res.json({ ok: true });
    })
  );

  // --- Model registry / routing (fraud-team self-service) ------------------
  r.get(
    "/v1/models",
    asyncH(async (_req, res) => {
      res.json({ models: await ctx.registry.list() });
    })
  );

  r.post(
    "/v1/models/:version/promote",
    asyncH(async (req, res) => {
      const status = req.body?.status as "prod" | "shadow" | "canary" | "retired";
      if (!["prod", "shadow", "canary", "retired"].includes(status)) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "invalid status" } });
        return;
      }
      const existing = await ctx.registry.get(req.params.version!);
      if (!existing) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "model not found" } });
        return;
      }
      await ctx.registry.promote(req.params.version!, status, Number(req.body?.canaryPct ?? 0));
      res.json({ ok: true, model: await ctx.registry.get(req.params.version!) });
    })
  );

  r.get(
    "/v1/routing",
    asyncH(async (_req, res) => {
      res.json({ thresholds: await ctx.router.thresholds() });
    })
  );

  r.put(
    "/v1/routing",
    asyncH(async (req, res) => {
      const cur = await ctx.router.thresholds();
      const next = {
        blockAt: clampMilli(req.body?.blockAt, cur.blockAt),
        challengeAt: clampMilli(req.body?.challengeAt, cur.challengeAt),
        flagAt: clampMilli(req.body?.flagAt, cur.flagAt),
        freezeAt: clampMilli(req.body?.freezeAt, cur.freezeAt),
      };
      await ctx.db.execute(
        "UPDATE routing_config SET block_at = ?, challenge_at = ?, flag_at = ?, freeze_at = ?, updated_at = ? WHERE id = 'default'",
        [next.blockAt, next.challengeAt, next.flagAt, next.freezeAt, new Date().toISOString()]
      );
      res.json({ thresholds: next });
    })
  );

  // --- Learning loop -------------------------------------------------------
  r.post(
    "/v1/labels",
    asyncH(async (req, res) => {
      const rec = await ctx.labels.record({
        userId: req.body?.userId,
        decisionId: req.body?.decisionId,
        label: req.body?.label,
        source: req.body?.source,
      });
      res.status(201).json({ label: rec });
    })
  );

  r.post(
    "/v1/retrain",
    asyncH(async (_req, res) => {
      res.json({ result: await ctx.retrainer.retrain() });
    })
  );

  return r;
}

function clampMilli(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

function serializeDecision(d: Decision) {
  return {
    decisionId: d.decisionId,
    eventId: d.eventId,
    userId: d.userId,
    mode: d.mode,
    score: d.score,
    action: d.action,
    reasons: d.reasons,
    explanation: d.explanation,
    modelVersion: d.modelVersion,
    shadow: d.shadow ?? [],
  };
}

function serializeDecisionRow(r: Record<string, unknown>) {
  return {
    decisionId: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    mode: r.mode,
    score: Number(r.score) / 1000,
    action: r.action,
    reasons: JSON.parse(String(r.reasons)),
    explanation: JSON.parse(String(r.explanation)),
    modelVersion: r.model_version,
    shadow: JSON.parse(String(r.shadow_json ?? "[]")),
    createdAt: r.created_at,
  };
}
