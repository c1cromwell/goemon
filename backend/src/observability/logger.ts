/**
 * Phase 1 — Structured logging (pino).
 *
 * JSON logs with redaction of secrets and sensitive fields. NEVER log full tokens,
 * VC/VP contents, passwords, or raw PII. Use a child logger per request with a
 * request id (see httpLogger).
 */

import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "../config";

export const logger = pino({
  level: config.isProd ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["idempotency-key"]',
      "password",
      "password_hash",
      "vc_jwt",
      "vp_token",
      "token",
      "access_token",
      "JWT_SECRET",
      "*.password",
      "*.vc_jwt",
      "*.token",
    ],
    censor: "[redacted]",
  },
  transport: prettyTransport(),
});

/**
 * Pretty (human) logs in non-production — but only if pino-pretty is actually
 * installed. A production image built with `--omit=dev` has no pino-pretty; if
 * such an image is run with NODE_ENV!=production (e.g. a local Docker smoke test),
 * requesting the transport would crash at import. Fall back to plain JSON instead.
 */
function prettyTransport(): pino.TransportSingleOptions | undefined {
  if (config.isProd) return undefined;
  try {
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } };
  } catch {
    return undefined;
  }
}

export const httpLogger = pinoHttp({
  logger,
  // Generate / propagate a request id
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id = (Array.isArray(existing) ? existing[0] : existing) ?? cryptoRandomId();
    res.setHeader("x-request-id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});

function cryptoRandomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("crypto").randomBytes(8).toString("hex");
}
