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
import { authRouter } from "./routes/auth";
import { identityRouter } from "./routes/identity";
import { agentsRouter } from "./routes/agents";
import { accountsRouter } from "./routes/accounts";
import { bootstrapSystemAccounts } from "./services/ledgerService";
import { initHedera } from "./services/hederaService";
import { hederaRouter } from "./routes/hedera";
import { onboardingRouter } from "./routes/onboarding";
import { adminRouter } from "./routes/admin";
import { smartchatRouter } from "./routes/smartchat";
import { requireAuth } from "./middleware/auth";
import { requireTier } from "./middleware/requireTier";

async function bootstrap(): Promise<void> {
  installBigIntJSONSerializer();

  // DB + migrations. In production, run `npm run migrate` as a deploy step instead.
  getDb();
  if (!config.isProd) {
    await runMigrations();
  }

  await initTokenFactory();
  await bootstrapSystemAccounts();
  await initHedera();

  const app = express();
  // Trust one hop of reverse-proxy so req.ip is the real client IP (not spoofable
  // via X-Forwarded-For when sitting behind a load balancer). Adjust the count
  // to match your deployment topology; 0 = no proxy trust in local dev.
  app.set("trust proxy", config.isProd ? 1 : 0);
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

  // Prometheus metrics — restricted to internal/token-authenticated callers (H-5).
  app.get("/metrics", (req, res, next) => {
    const token = config.METRICS_TOKEN;
    if (token) {
      const auth = req.header("authorization");
      if (auth !== `Bearer ${token}`) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    next();
  }, async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  // ---- Phase 2 routes ----
  app.use("/api/credentials", credentialsRouter);

  // ---- Phase 3 routes ----
  app.use("/api/auth", authRouter);
  app.use("/api/identity", identityRouter);
  app.use("/api/agents", agentsRouter);

  // ---- Phase 4 routes ----
  app.use("/api/accounts", accountsRouter);

  // ---- Phase 5 routes ----
  app.use("/api/hedera", hederaRouter);

  // ---- Phase 5A routes (agentic account opening + admin console) ----
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/admin", adminRouter);

  // ---- Phase 6 routes ----
  // SmartChat drives money operations, so gate it at Tier 2 (transfers unlock there).
  app.use("/api/smartchat", requireAuth, requireTier(2), smartchatRouter);

  // ---- Feature routes mounted in later phases ----
  // app.use("/api/ledger", ledgerRouter);              // Phase 4 (direct ledger admin)
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
