/**
 * Issuance service (Phase 29 P1 — the "tokenize anything" console).
 *
 * A thin orchestration over the engine primitives: it turns an issuer's plain
 * request (asset type + compliance profile + details + optional listing) into
 *   1. a minted asset (tokenizationService.createAsset), and
 *   2. an optional marketplace listing (listingService), soft-launched.
 *
 * It adds NO new money path — everything reuses the asset-type registry (defaults),
 * the compliance-profile registry (rules), createAsset (mint), and the listing
 * lifecycle. Gated by ISSUANCE_CONSOLE_ENABLED (prod-fatal prototype).
 *
 * See docs/TOKENIZATION-MASTER-PLAN.md (P1) and the two registries.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { createAsset, getAsset, listAssets, type Asset, type AssetKind } from "./tokenizationService";
import { getAssetType, listAssetTypes, isKnownAssetKind } from "./assetTypeRegistry";
import { isKnownComplianceProfile, listComplianceProfiles, resolveComplianceProfile } from "./complianceProfiles";
import { createListing, transitionListing, type Surface } from "./listingService";

export function assertIssuanceEnabled(): void {
  if (!config.ISSUANCE_CONSOLE_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "The issuance console is not enabled (set ISSUANCE_CONSOLE_ENABLED=true).");
  }
}

/** The pickers the console renders: asset types + compliance profiles, both from the registries. */
export function issuanceOptions() {
  return {
    enabled: config.ISSUANCE_CONSOLE_ENABLED,
    assetTypes: listAssetTypes(),
    complianceProfiles: listComplianceProfiles(),
  };
}

export interface IssueInput {
  issuerUserId: string;
  kind: string; // asset type (validated against the registry)
  name: string;
  symbol?: string;
  decimals?: number;
  /** Compliance profile name; defaults from the asset type when omitted. */
  complianceProfile?: string;
  minTier?: number;
  jurisdictionAllow?: string[];
  holderCap?: number;
  /** Investor-count / accreditation / whitelist inputs surfaced by the profile. */
  whitelist?: string[];
  /** Free-form domain fields (e.g. { building: "123 Maple St" }). */
  metadata?: Record<string, unknown>;
  custodyAttestationUri?: string;
  initialSupply: bigint;
  /** Optional immediate soft-launch listing. */
  listing?: { surface: Surface; priceMinor: bigint; priceSource?: string; currency?: string };
}

export interface IssueResult {
  asset: Asset;
  listed: boolean;
  complianceProfile: string;
}

export async function issueAsset(input: IssueInput): Promise<IssueResult> {
  assertIssuanceEnabled();

  if (!input.name?.trim()) throw new AppError(ErrorCode.VALIDATION, "Asset name is required");
  if (!isKnownAssetKind(input.kind)) throw new AppError(ErrorCode.VALIDATION, `Unknown asset type "${input.kind}"`);
  const typeDef = getAssetType(input.kind)!;
  if (!typeDef.enabled) throw new AppError(ErrorCode.VALIDATION, `Asset type "${input.kind}" is not available`);
  if (input.initialSupply <= 0n) throw new AppError(ErrorCode.VALIDATION, "Initial supply must be positive");

  // Resolve the compliance profile: explicit (validated) or the type's default.
  const complianceProfile = input.complianceProfile ?? typeDef.complianceProfile;
  if (!isKnownComplianceProfile(complianceProfile)) {
    throw new AppError(ErrorCode.VALIDATION, `Unknown compliance profile "${complianceProfile}"`);
  }

  // Metadata carries the chosen profile (so checkTransfer's resolveComplianceProfile picks it up)
  // plus any whitelist and domain fields.
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    complianceProfile,
    ...(input.whitelist && input.whitelist.length > 0 ? { whitelist: input.whitelist } : {}),
  };

  const asset = await createAsset({
    kind: typeDef.kind as AssetKind,
    tokenStandard: typeDef.defaultTokenStandard,
    name: input.name.trim(),
    symbol: input.symbol?.trim() || undefined,
    decimals: input.decimals,
    issuerUserId: input.issuerUserId,
    metadata,
    custodyAttestationUri: input.custodyAttestationUri,
    minTier: input.minTier,
    jurisdictionAllow: input.jurisdictionAllow,
    holderCap: input.holderCap,
    initialSupply: input.initialSupply,
  });

  // Sanity: the asset resolves to the profile we intended (metadata drives it).
  const effectiveProfile = resolveComplianceProfile(asset);

  let listed = false;
  if (input.listing) {
    await createListing({
      assetId: asset.id,
      surface: input.listing.surface,
      priceMinor: input.listing.priceMinor,
      currency: input.listing.currency,
      priceSource: input.listing.priceSource ?? (typeDef.isSecurity ? "nav" : "orderbook"),
      reviewer: `issuer:${input.issuerUserId}`,
    });
    // Soft-launch so it appears on the marketplace surface (listForUser shows soft+public).
    await transitionListing(asset.id, "soft", `issuer:${input.issuerUserId}`);
    listed = true;
  }

  await logAudit({
    userId: input.issuerUserId,
    action: "issuance.create",
    resource: asset.id,
    details: { kind: typeDef.kind, complianceProfile: effectiveProfile, listed, symbol: asset.symbol },
  });

  return { asset: (await getAsset(asset.id))!, listed, complianceProfile: effectiveProfile };
}

/** Assets this issuer has created (for the console's "your tokens" list). */
export async function listIssuedAssets(issuerUserId: string): Promise<Asset[]> {
  const all = await listAssets();
  return all.filter((a) => a.issuerUserId === issuerUserId);
}
