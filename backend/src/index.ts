/**
 * Phase 1 — Server bootstrap (foundation only).
 *
 * This wires together the Phase 0/1 foundation: config, DB, migrations (dev),
 * token factory, logging, metrics, rate limiting, and the error handler. Feature
 * routes (auth, identity, agents, credentials, present, mcp, smartchat, ledger,
 * hedera) are added in later phases.
 *
 * Exposed now:
 *   GET /api/health              -> { status, dialect }
 *   GET /metrics                 -> Prometheus metrics
 *   GET /api/.well-known/jwks.json -> RS256 public key (token factory)
 */

import express from "express";
import cors from "cors";
import { config } from "./config";
import { getDb } from "./db";
import { runMigrations } from "./db/migrate";
import { initTokenFactory, getJWKS } from "./utils/tokenFactory";
import { installBigIntJSONSerializer } from "./db/money";
import { logger, httpLogger } from "./observability/logger";
import { registry, httpRequestDuration } from "./observability/metrics";
import { apiLimiter } from "./middleware/rateLimit";
import { errorHandler } from "./errors";
import { credentialsRouter } from "./routes/credentials";

async function bootstrap(): Promise<void> {
  installBigIntJSONSerializer();

  // DB + migrations. In production, run `npm run migrate` as a deploy step instead.
  getDb();
  if (!config.isProd) {
    await runMigrations();
  }

  await initTokenFactory();

  const app = express();
  app.use(httpLogger);
  app.use(cors({ origin: config.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
  app.use(express.json());

  // Per-request duration metric
  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on("finish", () => {
      end({ method: req.method, route: req.path, status: String(res.statusCode) });
    });
    next();
  });

  app.use("/api", apiLimiter());

  // Health
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", dialect: getDb().dialect, env: config.NODE_ENV });
  });

  // JWKS for verifying RS256 scoped/exchange tokens
  app.get("/api/.well-known/jwks.json", (_req, res) => {
    res.json(getJWKS());
  });

  // Prometheus metrics
  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  // ---- Phase 2 routes ----
  app.use("/api/credentials", credentialsRouter);

  // ---- Feature routes mounted in later phases ----
  // app.use("/api/auth", authRouter);                 // Phase 3
  // app.use("/api/identity", identityRouter);          // Phase 3
  // app.use("/api/accounts", requireTier(2), accountsRouter);
  // app.use("/api/ledger", ledgerRouter);              // Phase 4
  // app.use("/api/hedera", hederaRouter);              // Phase 5
  // app.use("/api/smartchat", requireTier(2), smartchatRouter); // Phase 6
  // app.use("/mcp", mcpRouter);                        // Phase 7
  // ... etc.

  // Error handler LAST
  app.use(errorHandler);

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, dialect: getDb().dialect, env: config.NODE_ENV }, "BankAI backend listening");
  });
}

bootstrap().catch((e) => {
  logger.error(e, "Failed to start BankAI backend");
  process.exit(1);
});
