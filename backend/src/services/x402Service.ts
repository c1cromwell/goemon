/**
 * Phase 24.2 — x402 HTTP Payment Required (agent commerce on Goemon Pay).
 *
 * Composes with x401: identity proof first, then payment fulfillment on the native rail.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { createPaymentIntent, getIntent, payIntent, type PaymentIntentRow } from "./paymentService";
import { verifyCheckoutPresentation } from "./presentationService";
import { redeemVerificationToken } from "./x401Service";

export const X402_HEADER_REQUIRED = "PAYMENT-REQUIRED";
export const X402_HEADER_FULFILLMENT = "PAYMENT-FULFILLMENT";

export interface X402RequirementPayload {
  version: "1.0";
  payment_id: string;
  intent_id: string;
  amount_minor: string;
  currency: string;
  merchant_id: string;
  merchant_name: string;
  expires_at: string;
  resource?: string;
}

export interface X402FulfillmentPayload {
  intent_id: string;
  /** Checkout VP (device wallet). */
  vp_jwt?: string;
  /** x401 verification token (agent replay). */
  verification_token?: string;
}

function assertX402Enabled(): void {
  if (!config.X402_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "x402 agent commerce is not enabled");
  }
  if (!config.GOEMON_PAY_ENABLED) {
    throw new AppError(ErrorCode.PAY_DISABLED, "x402 requires Goemon Pay (GOEMON_PAY_ENABLED)");
  }
}

export function encodePaymentRequired(payload: X402RequirementPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePaymentRequired(headerValue: string): X402RequirementPayload {
  try {
    const json = Buffer.from(headerValue, "base64url").toString("utf8");
    return JSON.parse(json) as X402RequirementPayload;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "Invalid PAYMENT-REQUIRED header encoding");
  }
}

export function encodePaymentFulfillment(payload: X402FulfillmentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePaymentFulfillment(headerValue: string): X402FulfillmentPayload {
  try {
    const json = Buffer.from(headerValue, "base64url").toString("utf8");
    return JSON.parse(json) as X402FulfillmentPayload;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, "Invalid PAYMENT-FULFILLMENT header encoding");
  }
}

/** Build a 402 payment requirement for an existing intent (or create one inline). */
export async function buildPaymentRequiredForIntent(
  intent: PaymentIntentRow,
  resource?: string
): Promise<{ status: 402; header: string; payload: X402RequirementPayload }> {
  assertX402Enabled();
  const payload: X402RequirementPayload = {
    version: "1.0",
    payment_id: intent.id,
    intent_id: intent.id,
    amount_minor: intent.amountMinor,
    currency: intent.currency,
    merchant_id: intent.merchantId,
    merchant_name: intent.merchantName,
    expires_at: intent.expiresAt,
    resource,
  };
  return { status: 402, header: encodePaymentRequired(payload), payload };
}

/** Fulfill payment via VP or x401 verification token — returns paid intent. */
export async function fulfillPayment(input: {
  fulfillmentHeader: string;
  ipAddress?: string;
}): Promise<{ intent: PaymentIntentRow; payerUserId: string; authorizedVia: "vp" | "agent" }> {
  assertX402Enabled();
  const body = decodePaymentFulfillment(input.fulfillmentHeader);
  const intentId = body.intent_id;
  if (!intentId) throw new AppError(ErrorCode.VALIDATION, "intent_id required");

  const intent = await getIntent(intentId);
  if (!intent) throw new AppError(ErrorCode.NOT_FOUND, "Payment intent not found");

  let payerUserId: string;
  let authorizedVia: "vp" | "agent";
  let agentDid: string | undefined;
  let tokenJti: string | undefined;

  if (body.vp_jwt) {
    const pres = await verifyCheckoutPresentation({ vpJwt: body.vp_jwt, intentId, ipAddress: input.ipAddress });
    payerUserId = pres.userId;
    authorizedVia = "vp";
  } else if (body.verification_token) {
    const redeemed = await redeemVerificationToken(body.verification_token);
    if (!redeemed.scope.includes("pay:merchant")) {
      throw new AppError(ErrorCode.SCOPE_DENIED, "Verification token missing pay:merchant scope");
    }
    payerUserId = redeemed.userId;
    agentDid = redeemed.clientDid;
    tokenJti = redeemed.jti;
    authorizedVia = "agent";
  } else {
    throw new AppError(ErrorCode.VALIDATION, "vp_jwt or verification_token required");
  }

  const paid = await payIntent({
    intentId,
    payerUserId,
    authorizedVia: authorizedVia === "vp" ? "vp" : "agent",
    agentDid,
    tokenJti,
  });

  return { intent: paid, payerUserId, authorizedVia };
}

/** Create a merchant payment intent for an agent-commerce resource (demo / API merchants). */
export async function createAgentCommerceIntent(input: {
  merchantId: string;
  ownerUserId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  memo?: string;
}): Promise<PaymentIntentRow> {
  assertX402Enabled();
  return createPaymentIntent({
    merchantId: input.merchantId,
    actorUserId: input.ownerUserId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    memo: input.memo ?? "x402 agent commerce",
    idempotencyKey: input.idempotencyKey,
  });
}
