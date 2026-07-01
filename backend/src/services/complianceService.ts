/**
 * Phase 8 — Compliance Module + Identity Registry (in-app model of ERC-3643).
 *
 * For SECURITIES (erc3643 / kind === "security") a holding/transfer is permitted
 * only if the recipient:
 *   - is on the Identity Registry (has an identity profile),
 *   - meets the asset's minimum tier,
 *   - is in an allowed jurisdiction, and
 *   - would not push the asset over its holder-count cap (§12(g) style).
 * Non-securities (HTS collectibles/gaming) transfer freely between Goemon Global Finance users
 * (subject only to the asset's min_tier, if any).
 *
 * A deployed, audited ERC-3643 contract enforcing these on-chain is the
 * production item; this service is the prototype's faithful stand-in.
 */

import { getProfile } from "./identityService";
import type { Asset } from "./tokenizationService";
import { resolveComplianceProfile, runComplianceProfile } from "./complianceProfiles";

// Re-exported for backward compatibility (the type now lives in complianceProfiles).
export type { ComplianceResult } from "./complianceProfiles";

/**
 * Decide whether `toUserId` may RECEIVE `qtyBase` of `asset`.
 * `qtyBase` is informational here (cap logic only counts holders, not size).
 *
 * The dimensions live in a data-driven **compliance-profile registry**
 * (complianceProfiles.ts). The default profiles reproduce the historical behavior
 * exactly: `exempt-basic` (identity + tier) for non-securities, `security-erc3643`
 * (identity + tier + jurisdiction + holder-cap) for securities. An asset may opt into
 * a richer profile (e.g. whitelist/accreditation) via `metadata.complianceProfile`.
 */
export async function checkTransfer(asset: Asset, toUserId: string): ReturnType<typeof runComplianceProfile> {
  const profile = await getProfile(toUserId);

  // Identity Registry: the recipient must be a known identity (applies to every profile).
  if (!profile) return { allowed: false, reason: "Recipient is not on the identity registry" };

  return runComplianceProfile(resolveComplianceProfile(asset), { asset, toUserId, profile });
}
