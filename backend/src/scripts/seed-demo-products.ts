/**
 * Demo-products seed — enrich the portal so every surface looks populated for a
 * full-feature web demo. Idempotent: re-running is safe (assets guarded by symbol,
 * money actions keyed by fixed idempotency keys, kill-switched features skipped when off).
 *
 * Adds, on top of `npm run seed:marketplace` (MAPLE + FLEER57):
 *   - INVEST   : two more securities (a REIT fund + a second building), public listings.
 *   - COLLECT  : three more graded collectibles, public listings.
 *   - TREASURY : ensures the ATB asset exists (par-priced) for /earn + /borrow.
 *   - DROP     : one creator drop so /drops Browse is populated (if CREATOR_DROPS_ENABLED).
 *   - HOLDINGS : gives the named demo users (blair, alex) real positions so /earn,
 *                /borrow, /invest portfolio and /collect show data on first load.
 *
 * Run: npm run seed:products   (or the convenience `npm run seed:demo`)
 */

import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts } from "../services/ledgerService";
import { getUserByEmail } from "../services/authService";
import { createAsset, listAssets, type Asset } from "../services/tokenizationService";
import { createListing, transitionListing, getCurrentListing } from "../services/listingService";
import { subscribe, closeSubscription, placeOrder } from "../services/marketplaceService";
import * as treasury from "../services/treasuryService";
import * as lending from "../services/lendingService";
import * as drops from "../services/creatorDropService";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

type Surface = "invest" | "collect";

/** Create an asset only if one with the same symbol does not already exist (idempotent). */
async function ensureAsset(
  kind: Parameters<typeof createAsset>[0]["kind"],
  input: Omit<Parameters<typeof createAsset>[0], "kind"> & { symbol: string }
): Promise<Asset> {
  const existing = (await listAssets(kind)).find((a) => a.symbol === input.symbol);
  if (existing) return existing;
  return createAsset({ kind, ...input });
}

/** Create + publish a listing once; ignore if it already exists. */
async function ensureListing(assetId: string, surface: Surface, priceMinor: bigint, priceSource: string): Promise<void> {
  const current = await getCurrentListing(assetId);
  if (current) return;
  try {
    await createListing({ assetId, surface, priceMinor, priceSource, reviewer: "demo" });
    await transitionListing(assetId, "soft", "demo");
    await transitionListing(assetId, "public", "demo");
  } catch (e) {
    if (e instanceof AppError && e.code === ErrorCode.CONFLICT) return;
    throw e;
  }
}

async function main(): Promise<void> {
  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();

  // ---- INVEST: more tokenized securities ----
  const fund = await ensureAsset("security", {
    tokenStandard: "erc3643",
    name: "Goemon Greenfield Industrial REIT (DEMO)",
    symbol: "GREEN",
    minTier: 2,
    jurisdictionAllow: ["US"],
    holderCap: 199,
    metadata: { demo: true, sector: "industrial real estate", note: "Testnet demo asset — not a real offering" },
    initialSupply: 5000n,
  });
  await ensureListing(fund.id, "invest", 2_500n, "nav"); // $25.00 / unit

  const oak = await ensureAsset("security", {
    tokenStandard: "erc3643",
    name: "456 Oak Ave LLC — Membership Units (DEMO)",
    symbol: "OAK",
    minTier: 2,
    jurisdictionAllow: ["US"],
    holderCap: 99,
    metadata: { demo: true, building: "456 Oak Ave", note: "Testnet demo asset — not a real offering" },
    initialSupply: 1500n,
  });
  await ensureListing(oak.id, "invest", 10_000n, "nav"); // $100.00 / unit

  // ---- COLLECT: more graded collectibles ----
  const collectibles: Array<{ name: string; symbol: string; grade: string; priceMinor: bigint; supply: bigint }> = [
    { name: "1986 Jordan Fleer #57 — PSA 9", symbol: "JORDAN86", grade: "PSA 9", priceMinor: 89_000n, supply: 3n },
    { name: "1999 Pokémon Base Charizard — PSA 8", symbol: "ZARD99", grade: "PSA 8", priceMinor: 240_000n, supply: 2n },
    { name: "1952 Topps Mantle #311 — SGC 4", symbol: "MANTLE52", grade: "SGC 4", priceMinor: 1_950_000n, supply: 1n },
  ];
  const collectAssets: Asset[] = [];
  for (const c of collectibles) {
    const a = await ensureAsset("collectible", {
      tokenStandard: "hts",
      name: c.name,
      symbol: c.symbol,
      minTier: 0,
      metadata: { grade: c.grade, category: "cards", sanctioned: true },
      initialSupply: c.supply,
    });
    await ensureListing(a.id, "collect", c.priceMinor, "orderbook");
    collectAssets.push(a);
  }

  // ---- TREASURY: ensure the par-priced ATB asset exists (for /earn + /borrow) ----
  if (config.TREASURY_ENABLED) {
    await treasury.seedTreasury();
    console.log("[treasury] ATB asset ensured");
  } else {
    console.log("[treasury] TREASURY_ENABLED is off — skipping ATB seed");
  }

  // ---- Named demo-user holdings so pages aren't empty on first load ----
  const blair = await getUserByEmail("blair@demo.com");
  const alex = await getUserByEmail("alex@demo.com");
  if (!blair || !alex) {
    console.log("[holdings] demo users not found — run `npm run setup` first; skipping holdings");
  } else {
    // blair (Tier 2, accredited): a Treasury position + a small loan + a MAPLE/GREEN stake.
    if (config.TREASURY_ENABLED) {
      await treasury.subscribe({ userId: blair.id, qtyBase: 5_000n, idempotencyKey: "seed:blair:treasury" });
      console.log("[holdings] blair → $5,000 Treasury (ATB)");
      if (config.LENDING_ENABLED) {
        const atb = (await listAssets("treasury")).find((a) => a.symbol === "ATB");
        if (atb) {
          try {
            await lending.openLoan({
              userId: blair.id,
              collateralAssetId: atb.id,
              collateralQtyBase: 3_000n, // $3,000 collateral
              borrowMinor: 100_000n, // borrow $1,000 (well under the 50% LTV cap)
              idempotencyKey: "seed:blair:loan",
            });
            console.log("[holdings] blair → open loan: $1,000 against $3,000 ATB");
          } catch (e) {
            console.log(`[holdings] blair loan skipped: ${e instanceof AppError ? e.code : String(e)}`);
          }
        }
      }
    }
    // blair subscribes to a marketplace security (escrow → close) so /invest portfolio shows units.
    try {
      const sub = await subscribe(blair.id, fund.id, 20n, "seed:blair:green-sub");
      await closeSubscription(sub.orderId);
      console.log("[holdings] blair → 20 units of GREEN (subscription closed)");
    } catch (e) {
      console.log(`[holdings] blair GREEN subscription skipped: ${e instanceof AppError ? e.code : String(e)}`);
    }

    // alex (Tier 2): owns a graded collectible so /collect shows a holding.
    try {
      await placeOrder(alex.id, collectAssets[0]!.id, "buy", 1n, "seed:alex:jordan-buy");
      console.log("[holdings] alex → bought 1x JORDAN86");
    } catch (e) {
      console.log(`[holdings] alex collectible buy skipped: ${e instanceof AppError ? e.code : String(e)}`);
    }

    // ---- DROP: one creator drop (blair as creator) so /drops Browse is populated ----
    if (config.CREATOR_DROPS_ENABLED) {
      const already = (await drops.listDrops(blair.id)).some((d: any) => d?.name === "Goemon Genesis — Founders Edition");
      if (!already) {
        await drops.createDrop({
          creatorUserId: blair.id,
          name: "Goemon Genesis — Founders Edition",
          symbol: "GENESIS",
          editionSize: 100,
          priceMinor: 5_000n, // $50.00
          memo: "Limited founders edition — demo drop",
        });
        console.log("[drops] seeded 'Goemon Genesis — Founders Edition' (100 editions @ $50)");
      } else {
        console.log("[drops] founders-edition drop already present");
      }
    } else {
      console.log("[drops] CREATOR_DROPS_ENABLED is off — skipping drop seed");
    }
  }

  console.log("\nDemo-products seed complete.");
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[seed:products] failed:", e);
    await closeDb();
    process.exit(1);
  });
