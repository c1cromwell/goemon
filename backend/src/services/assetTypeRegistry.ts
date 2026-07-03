/**
 * Asset-type registry (Phase 29 — Tokenization Platform, engine layer Slice 1).
 *
 * The single source of truth for per-asset-KIND configuration. Previously each
 * kind's derived properties were scattered (the `isSecurity` OR-expression inline
 * in tokenizationService.toAsset, the token-standard choice in each seed/route).
 * This centralizes them so **adding a new asset class is a registry entry**, not a
 * code sweep — the same "config, not a rewrite" pattern as `currencyRegistry.ts`.
 *
 * This is a non-breaking refactor: the five existing kinds are registered with
 * values that reproduce today's behavior exactly (see asset-type-registry.test.ts).
 * The `AssetKind` union stays the compile-time allowlist; widening it to a string
 * validated against this registry is a trivial follow-up once the issuance console
 * (P1) needs runtime-defined types.
 *
 * See docs/TOKENIZATION-MASTER-PLAN.md (Phase 29, Slice 1).
 */

import type { AssetKind, TokenStandard } from "./tokenizationService";

export interface AssetTypeDef {
  kind: AssetKind;
  /** Default on-chain standard for this kind (erc3643 = compliance-gated security; hts = collectible/gaming). */
  defaultTokenStandard: TokenStandard;
  /** Intrinsic to the KIND (security/equity). An asset is also a security if its tokenStandard is erc3643. */
  isSecurity: boolean;
  /** The default compliance profile (complianceProfiles.ts) the issuance console suggests for this kind. */
  complianceProfile: string;
  /** Supports pro-rata corporate-action distributions (dividends / rent / royalties). */
  distributes: boolean;
  label: string;
  /** When false, the registry knows the type but the issuance surface won't offer it. */
  enabled: boolean;
}

/**
 * The registry. These entries reproduce the pre-refactor behavior exactly:
 *  - collectible/gaming → HTS, NOT intrinsically a security (free transfer, tier-only).
 *  - security/equity   → ERC-3643, intrinsically a security (full compliance).
 *  - treasury          → ERC-3643 but NOT intrinsically a security — it inherits
 *    "security" solely from its erc3643 token standard, matching the old inline rule
 *    (`kind === "security" || kind === "equity" || token_standard === "erc3643"`).
 */
const REGISTRY: Record<string, AssetTypeDef> = {
  collectible: { kind: "collectible", defaultTokenStandard: "hts", isSecurity: false, complianceProfile: "exempt-basic", distributes: false, label: "Collectible", enabled: true },
  gaming: { kind: "gaming", defaultTokenStandard: "hts", isSecurity: false, complianceProfile: "exempt-basic", distributes: false, label: "Gaming asset", enabled: true },
  security: { kind: "security", defaultTokenStandard: "erc3643", isSecurity: true, complianceProfile: "security-erc3643", distributes: true, label: "Security", enabled: true },
  equity: { kind: "equity", defaultTokenStandard: "erc3643", isSecurity: true, complianceProfile: "security-erc3643", distributes: true, label: "Equity (1:1 backed)", enabled: true },
  treasury: { kind: "treasury", defaultTokenStandard: "erc3643", isSecurity: false, complianceProfile: "security-erc3643", distributes: true, label: "Treasury", enabled: true },
  // RWA verticals (Phase 29) — each is JUST a registry entry + metadata; the engine
  // (issuance/compliance/raise/secondary/cockpit/distributions) works unchanged. See
  // docs/TOKENIZATION-MASTER-PLAN.md.
  //   real_estate — land / farmland / apartments; income (rent) distributes pro-rata.
  real_estate: { kind: "real_estate", defaultTokenStandard: "erc3643", isSecurity: true, complianceProfile: "security-erc3643", distributes: true, label: "Real estate", enabled: true },
  //   commodity — gold / silver / energy / timber; 1:1-backed good, freely tradeable (HTS,
  //   tier-only), proof-of-reserve in metadata (custodyAttestationUri). Not income-producing.
  commodity: { kind: "commodity", defaultTokenStandard: "hts", isSecurity: false, complianceProfile: "exempt-basic", distributes: false, label: "Commodity", enabled: true },
  //   royalty — music / film / patent / publishing income share; a security whose royalty
  //   stream distributes pro-rata via corporate actions.
  royalty: { kind: "royalty", defaultTokenStandard: "erc3643", isSecurity: true, complianceProfile: "security-erc3643", distributes: true, label: "IP royalty", enabled: true },
};

/** Look up a type definition (enabled or not), or undefined for an unknown kind. */
export function getAssetType(kind: string): AssetTypeDef | undefined {
  return REGISTRY[kind];
}

/** True if the kind is a known, registered asset type. */
export function isKnownAssetKind(kind: string): boolean {
  return kind in REGISTRY;
}

/** All enabled asset types (for the issuance console / type picker). */
export function listAssetTypes(): AssetTypeDef[] {
  return Object.values(REGISTRY).filter((t) => t.enabled);
}

/**
 * The `isSecurity` rule, centralized: intrinsic to the kind OR the token standard is
 * ERC-3643. Identical to the previous inline expression in `toAsset`.
 */
export function isSecurityKind(kind: string, tokenStandard: string): boolean {
  const def = REGISTRY[kind];
  return (def?.isSecurity ?? false) || tokenStandard === "erc3643";
}

/** The default compliance profile for a kind (used by the issuance console). */
export function defaultComplianceProfile(kind: string): string {
  return REGISTRY[kind]?.complianceProfile ?? "exempt-basic";
}

/** Whether a kind supports pro-rata corporate-action distributions (dividends / rent / royalties). */
export function assetKindDistributes(kind: string): boolean {
  return REGISTRY[kind]?.distributes ?? false;
}
