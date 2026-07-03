/**
 * RWA verticals seed — commodities + IP royalties (Phase 29).
 *
 * More proof of "onboard a profile, not a rewrite": these two verticals are just
 * `assetTypeRegistry` entries + metadata.
 *   - commodity — gold / silver, HTS, exempt (freely tradeable), proof-of-reserve in metadata.
 *   - royalty   — music / film income share, ERC-3643 security, royalty stream distributes
 *                 pro-rata via corporate actions (like a dividend).
 *
 * Run: npm run seed:verticals  (idempotent by symbol)
 */

import { runMigrations } from "../db/migrate";
import { closeDb } from "../db";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts } from "../services/ledgerService";
import { createAsset, listAssets, type AssetKind } from "../services/tokenizationService";
import { createListing, transitionListing, getCurrentListing } from "../services/listingService";

const ASSETS: Array<{
  kind: AssetKind; symbol: string; name: string; priceMinor: bigint; minTier: number;
  jurisdictionAllow?: string[]; holderCap?: number; metadata: Record<string, unknown>;
}> = [
  {
    kind: "commodity", symbol: "GOLD", name: "Allocated Gold — 1 oz vaulted", priceMinor: 240_000n, minTier: 0,
    metadata: { commodityType: "gold", unit: "troy_oz", purity: "999.9", custodyAttestationUri: "https://example.com/proof/gold", note: "1:1 allocated, vaulted; freely transferable." },
  },
  {
    kind: "commodity", symbol: "SILV", name: "Allocated Silver — 100 oz vaulted", priceMinor: 3_100n, minTier: 0,
    metadata: { commodityType: "silver", unit: "troy_oz", purity: "999", custodyAttestationUri: "https://example.com/proof/silver" },
  },
  {
    kind: "royalty", symbol: "MUSIC1", name: "\"Midnight Roads\" — master royalty share", priceMinor: 5_000n, minTier: 2, jurisdictionAllow: ["US"], holderCap: 199,
    metadata: { ipType: "music", title: "Midnight Roads", rightsHolder: "Aurora Records LLC", note: "Share of master recording royalties; distributed pro-rata." },
  },
  {
    kind: "royalty", symbol: "FILM1", name: "\"The Long Field\" — film revenue share", priceMinor: 10_000n, minTier: 2, jurisdictionAllow: ["US"], holderCap: 99,
    metadata: { ipType: "film", title: "The Long Field", rightsHolder: "Story County Pictures", note: "Backend revenue participation; distributed pro-rata." },
  },
];

async function ensure(a: (typeof ASSETS)[number]): Promise<void> {
  const existing = (await listAssets(a.kind)).find((x) => x.symbol === a.symbol);
  const asset = existing ?? await createAsset({
    kind: a.kind, tokenStandard: a.kind === "commodity" ? "hts" : "erc3643", name: a.name, symbol: a.symbol,
    minTier: a.minTier, jurisdictionAllow: a.jurisdictionAllow, holderCap: a.holderCap, metadata: a.metadata, initialSupply: 10_000n,
  });
  if (!(await getCurrentListing(asset.id))) {
    await createListing({ assetId: asset.id, surface: "invest", priceMinor: a.priceMinor, priceSource: a.kind === "commodity" ? "spot" : "nav", reviewer: "verticals-seed" });
    await transitionListing(asset.id, "soft", "verticals-seed");
    await transitionListing(asset.id, "public", "verticals-seed");
  }
  console.log(`[verticals] ${a.symbol} — ${a.kind} · ${a.name}`);
}

async function main(): Promise<void> {
  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();
  for (const a of ASSETS) await ensure(a);
  console.log("\nCommodity + royalty verticals seeded — zero engine changes.");
}

main()
  .then(async () => { await closeDb(); process.exit(0); })
  .catch(async (e) => { console.error("[seed:verticals] failed:", e); await closeDb(); process.exit(1); });
