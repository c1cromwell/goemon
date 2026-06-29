/**
 * Phase 24.2c — Stacked x401 + x402 agent commerce demo.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { getIntent } from "./paymentService";
import { issueProofRequirement } from "./x401Service";
import { buildPaymentRequiredForIntent } from "./x402Service";
import { isProductAvailable } from "./productCatalogService";

export interface AgentCommerceGate {
  x401Header: string;
  x402Header?: string;
  intentId?: string;
  resource: string;
  step: "identity" | "payment" | "complete";
}

export async function getAgentCommerceGate(input: {
  clientDid: string;
  intentId: string;
  resource: string;
  identityProven?: boolean;
  paymentComplete?: boolean;
}): Promise<AgentCommerceGate> {
  if (!config.X401_ENABLED || !config.X402_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Agent commerce requires X401_ENABLED and X402_ENABLED");
  }
  if (!isProductAvailable("agent.x402.commerce")) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "agent.x402.commerce SKU not available");
  }

  if (input.paymentComplete) {
    return { x401Header: "", resource: input.resource, step: "complete" };
  }

  if (!input.identityProven) {
    const proof = await issueProofRequirement(input.clientDid, ["pay:merchant", "balance:read"]);
    return {
      x401Header: proof.header,
      resource: input.resource,
      step: "identity",
    };
  }

  const intent = await getIntent(input.intentId);
  if (!intent) throw new AppError(ErrorCode.NOT_FOUND, "Payment intent not found");
  const pay = await buildPaymentRequiredForIntent(intent, input.resource);
  return {
    x401Header: "",
    x402Header: pay.header,
    intentId: intent.id,
    resource: input.resource,
    step: "payment",
  };
}
