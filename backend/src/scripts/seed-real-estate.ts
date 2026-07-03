/**
 * Real-estate vertical seed (Phase 29 — first onboarded RWA vertical).
 *
 * Creates three tokenized real-estate assets — a land parcel, a farmland tract, and an
 * apartment building — each an ERC-3643 security with property metadata, listed on the Invest
 * surface. The point: this required ZERO engine changes — just an `assetTypeRegistry` entry
 * (`real_estate`) + metadata. The whole platform (issuance console, compliance, capital raise,
 * secondary market, holder cockpit) works on these unchanged.
 *
 * Run: npm run seed:realestate  (idempotent by symbol)
 */

import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts } from "../services/ledgerService";
import { createAsset, listAssets } from "../services/tokenizationService";
import { createListing, transitionListing, getCurrentListing } from "../services/listingService";

const PROPERTIES = [
  {
    symbol: "LAND01", name: "40 acres — Kerr County, TX (raw land)", priceMinor: 5_000n, // $50/unit
    metadata: {
      propertyType: "land", address: "Tract 7, Kerr County, TX", valuationMinor: "20000000",
      complianceProfile: "security-erc3643", note: "Raw/undeveloped land held in an LLC-per-parcel.",
    },
  },
  {
    symbol: "FARM01", name: "160 acres — Story County, IA (farmland)", priceMinor: 10_000n, // $100/unit
    metadata: {
      propertyType: "farmland", address: "Section 12, Story County, IA", valuationMinor: "180000000",
      incomeMinor: "9000000", complianceProfile: "security-erc3643", note: "Row-crop farmland; lease income distributed pro-rata.",
    },
  },
  {
    symbol: "APTS01", name: "The Maple — 24-unit apartment building", priceMinor: 25_000n, // $250/unit
    metadata: {
      propertyType: "apartment", address: "123 Maple St, Columbus, OH", valuationMinor: "620000000",
      incomeMinor: "42000000", complianceProfile: "security-erc3643", note: "Stabilized multifamily; net rent distributed pro-rata.",
    },
  },
];

async function ensure(p: (typeof PROPERTIES)[number]): Promise<void> {
  const existing = (await listAssets("real_estate")).find((a) => a.symbol === p.symbol);
  const asset = existing ?? await createAsset({
    kind: "real_estate", tokenStandard: "erc3643", name: p.name, symbol: p.symbol,
    minTier: 2, jurisdictionAllow: ["US"], holderCap: 199, metadata: p.metadata, initialSupply: 10_000n,
  });
  if (!(await getCurrentListing(asset.id))) {
    await createListing({ assetId: asset.id, surface: "invest", priceMinor: p.priceMinor, priceSource: "nav", reviewer: "realestate-seed" });
    await transitionListing(asset.id, "soft", "realestate-seed");
    await transitionListing(asset.id, "public", "realestate-seed");
  }
  console.log(`[real-estate] ${p.symbol} — ${p.metadata.propertyType} · ${p.name}`);
}

async function main(): Promise<void> {
  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();
  for (const p of PROPERTIES) await ensure(p);
  console.log("\nReal-estate vertical seeded (land · farmland · apartments) — zero engine changes.");
}

main()
  .then(async () => { await closeDb(); process.exit(0); })
  .catch(async (e) => { console.error("[seed:realestate] failed:", e); await closeDb(); process.exit(1); });
