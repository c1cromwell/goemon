/**
 * Phase 8 — Compliance Module + Identity Registry (in-app model of ERC-3643).
 *
 * For SECURITIES (erc3643 / kind === "security") a holding/transfer is permitted
 * only if the recipient:
 *   - is on the Identity Registry (has an identity profile),
 *   - meets the asset's minimum tier,
 *   - is in an allowed jurisdiction, and
 *   - would not push the asset over its holder-count cap (§12(g) style).
 * Non-securities (HTS collectibles/gaming) transfer freely between BankAI users
 * (subject only to the asset's min_tier, if any).
 *
 * A deployed, audited ERC-3643 contract enforcing these on-chain is the
 * production item; this service is the prototype's faithful stand-in.
 */

import { getProfile } from "./identityService";
import { getAssetHolderCount, getAssetBalance } from "./ledgerService";
import type { Asset } from "./tokenizationService";

export interface ComplianceResult {
  allowed: boolean;
  reason?: string;
}

const OK: ComplianceResult = { allowed: true };

/**
 * Decide whether `toUserId` may RECEIVE `qtyBase` of `asset`.
 * `qtyBase` is informational here (cap logic only counts holders, not size).
 */
export async function checkTransfer(asset: Asset, toUserId: string): Promise<ComplianceResult> {
  const profile = await getProfile(toUserId);

  // Identity Registry: the recipient must be a known identity.
  if (!profile) return { allowed: false, reason: "Recipient is not on the identity registry" };

  // Minimum tier applies to every asset class.
  if (profile.tier < asset.minTier) {
    return { allowed: false, reason: `Recipient tier ${profile.tier} is below required tier ${asset.minTier}` };
  }

  // Beyond the tier check, only securities carry jurisdiction + holder-cap rules.
  if (!asset.isSecurity) return OK;

  // Jurisdiction: empty allow-list means all jurisdictions are permitted.
  const jurisdiction = (profile as { jurisdiction?: string }).jurisdiction ?? "US";
  if (asset.jurisdictionAllow.length > 0 && !asset.jurisdictionAllow.includes(jurisdiction)) {
    return { allowed: false, reason: `Recipient jurisdiction ${jurisdiction} is not permitted for this security` };
  }

  // Holder-count cap: only blocks if this would add a NEW holder beyond the cap.
  if (asset.holderCap !== null && asset.holderCap !== undefined) {
    const alreadyHolds = (await getAssetBalance(toUserId, asset.id)) > 0n;
    if (!alreadyHolds) {
      const holders = await getAssetHolderCount(asset.id);
      if (holders >= asset.holderCap) {
        return { allowed: false, reason: `Asset has reached its holder cap of ${asset.holderCap}` };
      }
    }
  }

  return OK;
}
