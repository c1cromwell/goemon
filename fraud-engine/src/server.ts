/**
 * Express app factory. Separated from index.ts so tests can mount the app over an
 * in-memory DB context without binding a port.
 */

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Context } from "./context";
import { buildRoutes } from "./api/routes";
import { logger } from "./observability/logger";
import { registry } from "./observability/metrics";

export function buildApp(ctx: Context): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "goeman-fraud-engine" });
  });

  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  app.use(buildRoutes(ctx));

  return app;
}
