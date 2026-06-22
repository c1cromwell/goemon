/**
 * Collectibles inventory provider seam — Courtyard / Collector Crypt (Module 05).
 *
 * Swappable CollectiblesProvider: simulated default with representative inventory;
 * courtyard/collectorcrypt are prod swaps requiring partner API keys.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import * as tokenization from "./tokenizationService";
import * as listings from "./listingService";

export interface ExternalCollectibleItem {
  externalId: string;
  title: string;
  category: string;
  askUsdcMicro: bigint;
  imageUrl?: string;
  custodyVault?: string;
  grade?: string;
  metadata?: Record<string, unknown>;
}

export interface CollectiblesProvider {
  name: string;
  fetchInventory(): Promise<ExternalCollectibleItem[]>;
}

const SIMULATED_INVENTORY: ExternalCollectibleItem[] = [
  {
    externalId: "cy-sim-psa10-charizard",
    title: "1999 Pokémon Base Set Charizard PSA 10",
    category: "pokemon",
    askUsdcMicro: 125_000_000_000n,
    imageUrl: "https://example.com/charizard.jpg",
    custodyVault: "Courtyard Delaware Vault (simulated)",
    grade: "PSA 10",
    metadata: { partner: "courtyard", redemption: true },
  },
  {
    externalId: "cy-sim-psa9-lugia",
    title: "2000 Pokémon Neo Genesis Lugia PSA 9",
    category: "pokemon",
    askUsdcMicro: 18_500_000_000n,
    custodyVault: "Courtyard Delaware Vault (simulated)",
    grade: "PSA 9",
  },
];

function simulatedProvider(): CollectiblesProvider {
  return { name: "simulated", async fetchInventory() { return SIMULATED_INVENTORY; } };
}

function notImplemented(name: string): CollectiblesProvider {
  return {
    name,
    async fetchInventory() {
      throw new AppError(
        ErrorCode.NOT_IMPLEMENTED,
        `COLLECTIBLES_PROVIDER=${name} is not wired — integrate partner API (inventory + custody attestation)`
      );
    },
  };
}

let provider: CollectiblesProvider | null = null;
export function setCollectiblesProvider(p: CollectiblesProvider | null): void {
  provider = p;
}

export function getCollectiblesProvider(): CollectiblesProvider {
  if (provider) return provider;
  switch (config.COLLECTIBLES_PROVIDER) {
    case "courtyard":
      return notImplemented("courtyard");
    case "collectorcrypt":
      return notImplemented("collectorcrypt");
    default:
      return simulatedProvider();
  }
}

export async function syncCollectiblesInventory(actorAdminId?: string): Promise<{
  runId: string;
  provider: string;
  fetched: number;
  upserted: number;
}> {
  const p = getCollectiblesProvider();
  const items = await p.fetchInventory();
  const db = getDb();
  const runId = uuidv4();
  let upserted = 0;

  for (const item of items) {
    const existing = await db.queryOne<{ id: string; asset_id: string | null }>(
      "SELECT id, asset_id FROM external_collectible_listings WHERE provider = ? AND external_id = ?",
      [p.name, item.externalId]
    );

    let assetId = existing?.asset_id ?? null;
    if (!assetId) {
      const asset = await tokenization.createAsset({
        kind: "collectible",
        tokenStandard: "hts",
        name: item.title,
        symbol: item.externalId.slice(0, 12),
        decimals: 0,
        metadata: { ...item.metadata, provider: p.name, externalId: item.externalId, imageUrl: item.imageUrl },
        custodyAttestationUri: item.custodyVault,
        minTier: 0,
        initialSupply: 1n,
      });
      assetId = asset.id;
      await listings.createListing({
        assetId,
        surface: "collect",
        priceMinor: item.askUsdcMicro,
        currency: "USDC",
        priceSource: `collectibles:${p.name}`,
        reviewer: "collectibles-sync",
      });
      await listings.transitionListing(assetId, "soft", "collectibles-sync");
      await listings.transitionListing(assetId, "public", "collectibles-sync");
    }

    if (existing) {
      await db.execute(
        `UPDATE external_collectible_listings
         SET title = ?, category = ?, ask_usdc_micro = ?, image_url = ?, custody_vault = ?, grade = ?,
             metadata_json = ?, asset_id = ?, synced_at = datetime('now'), status = 'active'
         WHERE id = ?`,
        [
          item.title,
          item.category,
          item.askUsdcMicro.toString(),
          item.imageUrl ?? null,
          item.custodyVault ?? null,
          item.grade ?? null,
          JSON.stringify(item.metadata ?? {}),
          assetId,
          existing.id,
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO external_collectible_listings
           (id, provider, external_id, asset_id, title, category, ask_usdc_micro, image_url, custody_vault, grade, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          p.name,
          item.externalId,
          assetId,
          item.title,
          item.category,
          item.askUsdcMicro.toString(),
          item.imageUrl ?? null,
          item.custodyVault ?? null,
          item.grade ?? null,
          JSON.stringify(item.metadata ?? {}),
        ]
      );
    }
    upserted++;
  }

  await db.execute(
    `INSERT INTO collectibles_sync_runs (id, provider, items_fetched, items_upserted, status)
     VALUES (?, ?, ?, ?, 'completed')`,
    [runId, p.name, items.length, upserted]
  );

  await logAudit({
    action: "collectibles.sync",
    resource: runId,
    details: { provider: p.name, fetched: items.length, upserted, actorAdminId: actorAdminId ?? null },
  });

  return { runId, provider: p.name, fetched: items.length, upserted };
}

export async function listExternalCollectibles(provider?: string): Promise<unknown[]> {
  const db = getDb();
  if (provider) {
    return db.query(
      "SELECT * FROM external_collectible_listings WHERE provider = ? AND status = 'active' ORDER BY synced_at DESC",
      [provider]
    );
  }
  return db.query(
    "SELECT * FROM external_collectible_listings WHERE status = 'active' ORDER BY synced_at DESC LIMIT 100"
  );
}
