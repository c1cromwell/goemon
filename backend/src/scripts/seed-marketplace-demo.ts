/**
 * Phase 8 — Marketplace demo seed (Hedera testnet / simulated, NO real money).
 *
 * Two ready-to-show flows under one marketplace:
 *   (a) COLLECT — HTS-native graded collectibles a Tier-0/1 user buys/sells/transfers
 *       (the intended first real-money surface).
 *   (b) INVEST DEMO — one single-building real-estate LLC tokenized as an ERC-3643
 *       security (Compliance Module + holder gating), Tier-2/accredited-gated:
 *       subscribe (escrow) → close → compliance-gated transfer, incl. a rejection
 *       example for an ineligible recipient. Clearly a DEMO asset (see the plan's
 *       "Legal posture & demo asset").
 *
 * Run: npm run seed:marketplace
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts, getOrCreateUserAccount, getAssetBalance } from "../services/ledgerService";
import { createUser } from "../services/authService";
import { createAsset } from "../services/tokenizationService";
import { createListing, transitionListing } from "../services/listingService";
import { subscribe, closeSubscription, placeOrder, transferAsset } from "../services/marketplaceService";
import { AppError } from "../errors";

async function makeUser(label: string, tier: number, jurisdiction = "US"): Promise<string> {
  const u = await createUser(`${label}-${Date.now()}@demo.com`, label);
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening balance
  await getDb().execute("UPDATE identity_profiles SET tier = ?, jurisdiction = ? WHERE user_id = ?", [tier, jurisdiction, u.id]);
  return u.id;
}

async function main(): Promise<void> {
  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();

  // ---- (a) COLLECT: HTS-native graded collectibles ----
  const card = await createAsset({
    kind: "collectible",
    tokenStandard: "hts",
    name: "1986 Fleer #57 — PSA 10",
    symbol: "FLEER57",
    minTier: 0,
    metadata: { grade: "PSA 10", category: "cards", sanctioned: true },
    initialSupply: 5n,
  });
  await createListing({ assetId: card.id, surface: "collect", priceMinor: 124_000n, priceSource: "orderbook", reviewer: "demo" });
  await transitionListing(card.id, "soft", "demo");
  await transitionListing(card.id, "public", "demo");

  const collector = await makeUser("collector", 1);
  const buy = await placeOrder(collector, card.id, "buy", 1n, uuidv4());
  console.log(`[collect] collector bought 1x ${card.name} — order ${buy.orderId}, paid ${buy.netMinor} cents`);

  const friend = await makeUser("friend", 0);
  await transferAsset(collector, friend, card.id, 1n, uuidv4()); // non-security: free transfer
  console.log(`[collect] transferred the card to a friend (no compliance gate for collectibles)`);

  // ---- (b) INVEST DEMO: single-building ERC-3643 security ----
  const issuer = await makeUser("maple-st-llc", 4);
  const building = await createAsset({
    kind: "security",
    tokenStandard: "erc3643",
    name: "123 Maple St LLC — Membership Units (DEMO)",
    symbol: "MAPLE",
    issuerUserId: issuer,
    minTier: 2,
    jurisdictionAllow: ["US"],
    holderCap: 99, // §12(g)-style cap
    metadata: { demo: true, building: "123 Maple St", note: "Testnet demo asset — not a real offering" },
    initialSupply: 1000n,
  });
  await createListing({ assetId: building.id, surface: "invest", priceMinor: 5_000n, priceSource: "nav", reviewer: "demo" });
  await transitionListing(building.id, "soft", "demo");

  const accredited = await makeUser("accredited", 2);
  const sub = await subscribe(accredited, building.id, 10n, uuidv4());
  console.log(`[invest] accredited subscribed to 10 units (escrow) — order ${sub.orderId}, escrowed ${sub.netMinor} cents`);
  await closeSubscription(sub.orderId);
  console.log(`[invest] subscription closed → holder now owns ${await getAssetBalance(accredited, building.id)} units`);

  // Compliance rejection example: transfer to a Tier-1 (ineligible) recipient.
  const ineligible = await makeUser("retail", 1);
  try {
    await transferAsset(accredited, ineligible, building.id, 1n, uuidv4());
    console.log("[invest] UNEXPECTED: transfer to ineligible recipient succeeded");
  } catch (e) {
    const reason = e instanceof AppError ? `${e.code}: ${e.message}` : String(e);
    console.log(`[invest] compliance correctly blocked transfer to a Tier-1 recipient → ${reason}`);
  }

  console.log("\nMarketplace demo seed complete.");
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[seed:marketplace] failed:", e);
    await closeDb();
    process.exit(1);
  });
