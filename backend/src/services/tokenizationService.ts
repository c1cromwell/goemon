/**
 * Phase 8 — Token issuance abstraction.
 *
 * Creates tokenized assets and mints supply into the asset treasury via a
 * balanced ledger journal (asset_equity → asset_treasury, in the asset's own
 * ledger currency code). Two standards:
 *   - HTS native (collectibles/gaming): a token id is provisioned (simulated here;
 *     a real HTS create/mint via the operator is a production item — see the plan).
 *   - ERC-3643 (securities): the on-chain transfer rules are modeled in-app by
 *     complianceService (Identity Registry + Compliance Module). A deployed,
 *     audited contract is the production item.
 *
 * Supply is integer base units (bigint), never float — the same discipline as money.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { isHederaEnabled } from "./hederaService";
import {
  assetLedgerCode,
  getOrCreateAssetTreasury,
  getOrCreateAssetEquity,
  getBalance,
  postJournal,
} from "./ledgerService";

export type AssetKind = "security" | "collectible" | "gaming";
export type TokenStandard = "erc3643" | "hts";

export interface AssetRow {
  id: string;
  kind: AssetKind;
  token_standard: TokenStandard;
  hedera_token_id: string | null;
  issuer_user_id: string | null;
  name: string;
  symbol: string | null;
  decimals: number;
  metadata: string;
  custody_attestation_uri: string | null;
  min_tier: number;
  jurisdiction_allow: string;
  holder_cap: number | null;
  total_supply: number | string;
  status: string;
  created_at: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  tokenStandard: TokenStandard;
  hederaTokenId: string | null;
  issuerUserId: string | null;
  name: string;
  symbol: string | null;
  decimals: number;
  metadata: Record<string, unknown>;
  custodyAttestationUri: string | null;
  minTier: number;
  jurisdictionAllow: string[];
  holderCap: number | null;
  totalSupply: bigint;
  status: string;
  isSecurity: boolean;
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    tokenStandard: row.token_standard,
    hederaTokenId: row.hedera_token_id,
    issuerUserId: row.issuer_user_id,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    metadata: JSON.parse(row.metadata || "{}"),
    custodyAttestationUri: row.custody_attestation_uri,
    minTier: row.min_tier,
    jurisdictionAllow: JSON.parse(row.jurisdiction_allow || "[]"),
    holderCap: row.holder_cap,
    totalSupply: BigInt(row.total_supply ?? 0),
    status: row.status,
    isSecurity: row.kind === "security" || row.token_standard === "erc3643",
  };
}

export interface CreateAssetInput {
  kind: AssetKind;
  tokenStandard: TokenStandard;
  name: string;
  symbol?: string;
  decimals?: number;
  issuerUserId?: string;
  metadata?: Record<string, unknown>;
  custodyAttestationUri?: string;
  minTier?: number;
  jurisdictionAllow?: string[];
  holderCap?: number;
  /** Initial supply (base units) minted into the treasury. */
  initialSupply?: bigint;
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  if (!input.name) throw new AppError(ErrorCode.VALIDATION, "Asset name required");
  const id = uuidv4();
  // Real HTS token create/mint is a production item; provision a simulated id.
  const hederaTokenId =
    input.tokenStandard === "hts"
      ? isHederaEnabled()
        ? `0.0.SIM-${id.slice(0, 8)}` // placeholder until a real operator create is wired
        : `SIMTOKEN-${id.slice(0, 8)}`
      : null;

  await getDb().execute(
    `INSERT INTO assets
       (id, kind, token_standard, hedera_token_id, issuer_user_id, name, symbol, decimals, metadata,
        custody_attestation_uri, min_tier, jurisdiction_allow, holder_cap, total_supply, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
    [
      id,
      input.kind,
      input.tokenStandard,
      hederaTokenId,
      input.issuerUserId ?? null,
      input.name,
      input.symbol ?? null,
      input.decimals ?? 0,
      JSON.stringify(input.metadata ?? {}),
      input.custodyAttestationUri ?? null,
      input.minTier ?? 0,
      JSON.stringify(input.jurisdictionAllow ?? []),
      input.holderCap ?? null,
      new Date().toISOString(),
    ]
  );
  await logAudit({
    action: "asset.create",
    resource: id,
    details: { kind: input.kind, tokenStandard: input.tokenStandard, name: input.name },
  });

  if (input.initialSupply && input.initialSupply > 0n) {
    await mint(id, input.initialSupply);
  }
  return (await getAsset(id))!;
}

/** Mint additional supply into the treasury (asset_equity → asset_treasury). */
export async function mint(assetId: string, qtyBase: bigint): Promise<void> {
  if (qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "Mint quantity must be positive");
  const asset = await getAsset(assetId);
  if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  const code = assetLedgerCode(assetId);

  await getDb().transaction(async (tx) => {
    const equityId = await getOrCreateAssetEquity(assetId, tx);
    const treasuryId = await getOrCreateAssetTreasury(assetId, tx);
    await postJournal(
      [
        { ledgerAccountId: equityId, direction: "debit", amountMinor: qtyBase, currency: code },
        { ledgerAccountId: treasuryId, direction: "credit", amountMinor: qtyBase, currency: code },
      ],
      `Mint ${qtyBase} of asset ${assetId}`,
      { db: tx }
    );
    await tx.execute("UPDATE assets SET total_supply = total_supply + ? WHERE id = ?", [qtyBase.toString(), assetId]);
  });
  await logAudit({ action: "asset.mint", resource: assetId, details: { qtyBase: qtyBase.toString() } });
}

export async function getAsset(assetId: string): Promise<Asset | null> {
  const row = await getDb().queryOne<AssetRow>("SELECT * FROM assets WHERE id = ?", [assetId]);
  return row ? toAsset(row) : null;
}

export async function requireAsset(assetId: string): Promise<Asset> {
  const a = await getAsset(assetId);
  if (!a) throw new AppError(ErrorCode.NOT_FOUND, "Asset not found");
  return a;
}

export async function listAssets(kind?: AssetKind): Promise<Asset[]> {
  const rows = kind
    ? await getDb().query<AssetRow>("SELECT * FROM assets WHERE kind = ? ORDER BY created_at DESC", [kind])
    : await getDb().query<AssetRow>("SELECT * FROM assets ORDER BY created_at DESC");
  return rows.map(toAsset);
}

/** Treasury (un-distributed) supply available to sell, in base units. */
export async function treasuryAvailable(assetId: string): Promise<bigint> {
  const treasuryId = await getOrCreateAssetTreasury(assetId);
  return getBalance(treasuryId);
}
