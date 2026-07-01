/**
 * Compliance-profile registry (Phase 29 — engine layer Slice 2; "compliance-as-a-service").
 *
 * The Compliance Module used to hardcode its dimensions inline in
 * complianceService.checkTransfer (identity + tier for all; +jurisdiction +holder-cap
 * for securities). This makes those dimensions **composable, named profiles** so a new
 * asset class inherits the regulatory logic by naming a profile — and new dimensions
 * (accreditation, whitelists, lockups, sanctions…) are added ONCE and every profile
 * composes them.
 *
 * NON-BREAKING: the two seeded profiles reproduce today's behavior exactly, and the
 * new dimensions are available but NOT attached to the legacy profiles (zero behavior
 * change). An asset opts into a custom profile via `metadata.complianceProfile` — no
 * schema migration required. See docs/TOKENIZATION-MASTER-PLAN.md (P2).
 */

import type { Asset } from "./tokenizationService";
import type { IdentityProfile } from "./identityService";
import { getAssetHolderCount, getAssetBalance } from "./ledgerService";

export interface ComplianceResult {
  allowed: boolean;
  reason?: string;
}

const OK: ComplianceResult = { allowed: true };

/** Context passed to each dimension. `profile` is the recipient's identity (already known non-null). */
export interface DimensionCtx {
  asset: Asset;
  toUserId: string;
  profile: IdentityProfile;
}

export type Dimension = (ctx: DimensionCtx) => ComplianceResult | Promise<ComplianceResult>;

/**
 * The dimension library — each check is independent and composable. The first four
 * reproduce the pre-refactor logic verbatim; the rest are new, opt-in building blocks.
 */
export const DIMENSIONS: Record<string, Dimension> = {
  // Minimum tier — applied to every asset class (was the first securities-agnostic check).
  minTier: ({ asset, profile }) =>
    profile.tier < asset.minTier
      ? { allowed: false, reason: `Recipient tier ${profile.tier} is below required tier ${asset.minTier}` }
      : OK,

  // Jurisdiction allow-list — empty list means all jurisdictions permitted.
  jurisdictionAllow: ({ asset, profile }) => {
    const jurisdiction = (profile as { jurisdiction?: string }).jurisdiction ?? "US";
    if (asset.jurisdictionAllow.length > 0 && !asset.jurisdictionAllow.includes(jurisdiction)) {
      return { allowed: false, reason: `Recipient jurisdiction ${jurisdiction} is not permitted for this security` };
    }
    return OK;
  },

  // Holder-count cap (§12(g) style) — only blocks a NEW holder beyond the cap.
  holderCap: async ({ asset, toUserId }) => {
    if (asset.holderCap === null || asset.holderCap === undefined) return OK;
    const alreadyHolds = (await getAssetBalance(toUserId, asset.id)) > 0n;
    if (!alreadyHolds) {
      const holders = await getAssetHolderCount(asset.id);
      if (holders >= asset.holderCap) {
        return { allowed: false, reason: `Asset has reached its holder cap of ${asset.holderCap}` };
      }
    }
    return OK;
  },

  // --- NEW, opt-in dimensions (not attached to the legacy profiles) ---

  // Explicit allow-list of user ids on the asset (metadata.whitelist). No schema change.
  whitelist: ({ asset, toUserId }) => {
    const wl = (asset.metadata as { whitelist?: unknown }).whitelist;
    if (Array.isArray(wl) && !wl.includes(toUserId)) {
      return { allowed: false, reason: "Recipient is not on the asset whitelist" };
    }
    return OK;
  },

  // Accredited-investor gate (Reg D). Reads a profile flag; absent → not accredited.
  accreditation: ({ profile }) => {
    const accredited = (profile as { accredited?: boolean }).accredited === true;
    return accredited ? OK : { allowed: false, reason: "Recipient is not an accredited investor" };
  },
};

/**
 * Named profiles — an ordered list of dimension keys. The first two are the current
 * behavior; the rest are illustrative extensions an asset can opt into via
 * `metadata.complianceProfile`.
 */
export const PROFILES: Record<string, string[]> = {
  // Non-securities (collectibles/gaming): identity (checked upstream) + tier only.
  "exempt-basic": ["minTier"],
  // ERC-3643 securities: identity + tier + jurisdiction + holder cap. (Today's behavior.)
  "security-erc3643": ["minTier", "jurisdictionAllow", "holderCap"],
  // Extensions (opt-in): security + an explicit whitelist / accreditation gate.
  "security-whitelisted": ["minTier", "jurisdictionAllow", "holderCap", "whitelist"],
  "security-accredited": ["minTier", "jurisdictionAllow", "holderCap", "accreditation"],
};

/**
 * Resolve which profile governs an asset: an explicit, valid `metadata.complianceProfile`
 * wins; otherwise fall back to the security/exempt default (matching the old isSecurity
 * branch exactly).
 */
export function resolveComplianceProfile(asset: Asset): string {
  const explicit = (asset.metadata as { complianceProfile?: unknown }).complianceProfile;
  if (typeof explicit === "string" && explicit in PROFILES) return explicit;
  return asset.isSecurity ? "security-erc3643" : "exempt-basic";
}

/** Run a profile's dimensions in order, short-circuiting on the first failure. */
export async function runComplianceProfile(profileName: string, ctx: DimensionCtx): Promise<ComplianceResult> {
  const dims = PROFILES[profileName] ?? PROFILES["exempt-basic"]!;
  for (const key of dims) {
    const dim = DIMENSIONS[key];
    if (!dim) continue; // unknown dimension name is a no-op (defensive)
    const result = await dim(ctx);
    if (!result.allowed) return result;
  }
  return OK;
}
