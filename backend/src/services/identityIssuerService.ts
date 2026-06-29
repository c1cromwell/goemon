/**
 * Phase 24.1c — Identity issuer seam (Goemon VC default; Proof.com optional adapter).
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export type IdentityIssuerKind = "goemon" | "proof";

export interface IdentityIssuerStatus {
  issuer: IdentityIssuerKind;
  configured: boolean;
  standaloneReady: boolean;
  description: string;
}

export function getIdentityIssuerStatus(): IdentityIssuerStatus {
  const issuer = config.IDENTITY_ISSUER;
  if (issuer === "goemon") {
    return {
      issuer: "goemon",
      configured: true,
      standaloneReady: true,
      description: "Goemon-issued W3C VC + wallet did:key — no external identity partner",
    };
  }
  const configured = !!config.PROOF_API_KEY;
  return {
    issuer: "proof",
    configured,
    standaloneReady: false,
    description: configured
      ? "Proof.com OID4VC adapter (API key present)"
      : "Proof.com selected but PROOF_API_KEY unset — set key or use IDENTITY_ISSUER=goemon",
  };
}

/** Resolve an external proof challenge via Proof.com (stub — wire when contract signed). */
export async function fetchProofIssuerMetadata(): Promise<{ issuer: string; configured: boolean }> {
  if (config.IDENTITY_ISSUER !== "proof") {
    return { issuer: "goemon", configured: true };
  }
  if (!config.PROOF_API_KEY) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "IDENTITY_ISSUER=proof requires PROOF_API_KEY");
  }
  // Partner API seam — returns configured=true when key present; live OID4VC exchange is partner-gated.
  return { issuer: "https://proof.com", configured: true };
}
