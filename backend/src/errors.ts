/**
 * Phase 0 — Error taxonomy.
 *
 * Every error returned to a client uses a stable, machine-readable code so that
 * clients (web, iOS, the external agent) can branch on `error.code` rather than
 * parsing human text. The envelope is always:
 *   { error: { code, message, retryable } }
 */

import type { Response } from "express";

export enum ErrorCode {
  // Auth / access
  UNAUTHENTICATED = "UNAUTHENTICATED",
  FORBIDDEN = "FORBIDDEN",
  TIER_REQUIRED = "TIER_REQUIRED",
  RATE_LIMITED = "RATE_LIMITED",
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",

  // Validation
  VALIDATION = "VALIDATION",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",

  // Money / ledger
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  UNBALANCED_JOURNAL = "UNBALANCED_JOURNAL",
  CURRENCY_MISMATCH = "CURRENCY_MISMATCH",

  // Credential / presentation (agent access)
  VP_INVALID = "VP_INVALID",
  SCOPE_DENIED = "SCOPE_DENIED",
  GRANT_MISSING = "GRANT_MISSING",
  CREDENTIAL_REVOKED = "CREDENTIAL_REVOKED",
  NONCE_INVALID = "NONCE_INVALID",
  REPLAY_DETECTED = "REPLAY_DETECTED",

  // Marketplace (tokenized assets)
  COMPLIANCE_BLOCKED = "COMPLIANCE_BLOCKED",

  // Fraud / risk (Stage 1 fraud seam)
  FRAUD_BLOCKED = "FRAUD_BLOCKED",

  // Account frozen by fraud remediation (Phase 20 fraud add-on callback)
  ACCOUNT_FROZEN = "ACCOUNT_FROZEN",

  // Trading (Phase 17 Stage 1 seam)
  TRADING_DISABLED = "TRADING_DISABLED",

  // Argus Pay (Phase 21 Stage 1 rail)
  PAY_DISABLED = "PAY_DISABLED",

  // Reconciliation (Phase 20 — ledger⇄chain drift gates on-chain settlement)
  RECONCILIATION_HOLD = "RECONCILIATION_HOLD",

  // Internal agent operations (Phase 15 — back-office runner kill-switch)
  AGENT_DISABLED = "AGENT_DISABLED",

  // Tokenized equities (Phase 18.6 — prototype kill-switch)
  EQUITIES_DISABLED = "EQUITIES_DISABLED",

  // Full-bank rails (Phase 19 Stage-1 — prototype kill-switch)
  BANK_RAILS_DISABLED = "BANK_RAILS_DISABLED",

  // Debit cards (Phase 19.4 — prototype kill-switch)
  CARDS_DISABLED = "CARDS_DISABLED",

  // Generic
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  INTERNAL = "INTERNAL",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
}

const DEFAULT_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.TIER_REQUIRED]: 403,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.ACCOUNT_LOCKED]: 429,
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ErrorCode.INSUFFICIENT_FUNDS]: 422,
  [ErrorCode.UNBALANCED_JOURNAL]: 500,
  [ErrorCode.CURRENCY_MISMATCH]: 422,
  [ErrorCode.VP_INVALID]: 400,
  [ErrorCode.SCOPE_DENIED]: 403,
  [ErrorCode.GRANT_MISSING]: 403,
  [ErrorCode.CREDENTIAL_REVOKED]: 403,
  [ErrorCode.NONCE_INVALID]: 400,
  [ErrorCode.REPLAY_DETECTED]: 409,
  [ErrorCode.COMPLIANCE_BLOCKED]: 403,
  [ErrorCode.FRAUD_BLOCKED]: 403,
  [ErrorCode.ACCOUNT_FROZEN]: 403,
  [ErrorCode.TRADING_DISABLED]: 503,
  [ErrorCode.PAY_DISABLED]: 503,
  [ErrorCode.AGENT_DISABLED]: 503,
  [ErrorCode.EQUITIES_DISABLED]: 503,
  [ErrorCode.BANK_RAILS_DISABLED]: 503,
  [ErrorCode.CARDS_DISABLED]: 503,
  [ErrorCode.RECONCILIATION_HOLD]: 503,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
};

const RETRYABLE: Set<ErrorCode> = new Set([ErrorCode.RATE_LIMITED, ErrorCode.INTERNAL]);

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

/** Application error carrying a stable code. Throw this anywhere; the error
 *  middleware turns it into the standard envelope with the right HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message?: string, opts?: { httpStatus?: number; retryable?: boolean }) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? DEFAULT_HTTP_STATUS[code];
    this.retryable = opts?.retryable ?? RETRYABLE.has(code);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

/** Convenience constructors. */
export const errors = {
  unauthenticated: (m = "Authentication required") => new AppError(ErrorCode.UNAUTHENTICATED, m),
  forbidden: (m = "Forbidden") => new AppError(ErrorCode.FORBIDDEN, m),
  tierRequired: (m = "Higher identity tier required") => new AppError(ErrorCode.TIER_REQUIRED, m),
  validation: (m: string) => new AppError(ErrorCode.VALIDATION, m),
  notFound: (m = "Not found") => new AppError(ErrorCode.NOT_FOUND, m),
  insufficientFunds: (m = "Insufficient funds") => new AppError(ErrorCode.INSUFFICIENT_FUNDS, m),
  internal: (m = "Internal error") => new AppError(ErrorCode.INTERNAL, m),
  notImplemented: (m = "Not implemented") => new AppError(ErrorCode.NOT_IMPLEMENTED, m),
};

/**
 * Express error-handling middleware. Mount LAST with app.use(errorHandler).
 * Unknown errors become a generic INTERNAL envelope (never leak internals).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function errorHandler(err: any, _req: any, res: Response, _next: any): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json(err.toEnvelope());
    return;
  }
  // Log the real error server-side (the logger redacts; here we keep it simple).
  // eslint-disable-next-line no-console
  console.error("[unhandled]", err);
  const internal = new AppError(ErrorCode.INTERNAL, "An unexpected error occurred");
  res.status(internal.httpStatus).json(internal.toEnvelope());
}
