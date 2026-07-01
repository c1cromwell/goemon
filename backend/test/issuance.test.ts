/**
 * Phase 29 P1 — issuance console (issuanceService).
 *
 * Verifies the console orchestration: pickers come from the registries; a collectible
 * issues with the exempt profile; a security issues with a profile + soft-launch
 * listing and is compliance-gated; the kill-switch blocks when off.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP_DB = `./data/test-issuance-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";

  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();

  const { config } = await import("../src/config");
  (config as { ISSUANCE_CONSOLE_ENABLED: boolean }).ISSUANCE_CONSOLE_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

let seq = 0;
async function makeIssuer(): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getDb } = await import("../src/db");
  const u = await createUser(`issuer-${seq++}-${Date.now()}@test.com`, "Issuer");
  await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [u.id]);
  return u.id;
}

describe("issuance console — pickers", () => {
  it("exposes asset types and compliance profiles from the registries", async () => {
    const { issuanceOptions } = await import("../src/services/issuanceService");
    const opts = issuanceOptions();
    expect(opts.enabled).toBe(true);
    expect(opts.assetTypes.map((t) => t.kind).sort()).toEqual(["collectible", "equity", "gaming", "security", "treasury"]);
    const profiles = opts.complianceProfiles.map((p) => p.name);
    expect(profiles).toContain("exempt-basic");
    expect(profiles).toContain("security-erc3643");
    // Plain-language labels are present for the UI.
    expect(opts.complianceProfiles.every((p) => p.label.length > 0)).toBe(true);
  });
});

describe("issuance console — issue", () => {
  it("issues a collectible with the exempt default profile, minted supply", async () => {
    const { issueAsset } = await import("../src/services/issuanceService");
    const issuer = await makeIssuer();
    const res = await issueAsset({
      issuerUserId: issuer, kind: "collectible", name: "Founders Card", symbol: "FND", initialSupply: 100n,
    });
    expect(res.asset.isSecurity).toBe(false);
    expect(res.asset.totalSupply).toBe(100n);
    expect(res.complianceProfile).toBe("exempt-basic");
    expect(res.listed).toBe(false);
  });

  it("issues a security with a profile + soft-launch listing; compliance gates recipients", async () => {
    const { issueAsset } = await import("../src/services/issuanceService");
    const { checkTransfer } = await import("../src/services/complianceService");
    const { getAsset } = await import("../src/services/tokenizationService");
    const { createUser } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");

    const issuer = await makeIssuer();
    const res = await issueAsset({
      issuerUserId: issuer, kind: "security", name: "123 Main LLC Units", symbol: "MAIN",
      minTier: 2, jurisdictionAllow: ["US"], holderCap: 50, initialSupply: 1000n,
      listing: { surface: "invest", priceMinor: 5_000n },
    });
    expect(res.asset.isSecurity).toBe(true);
    expect(res.listed).toBe(true);
    expect(res.complianceProfile).toBe("security-erc3643");

    // The soft-launched listing appears on the marketplace surface.
    const { listForUser } = await import("../src/services/listingService");
    const buyer = await createUser(`buyer-${seq++}-${Date.now()}@test.com`, "Buyer");
    await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [buyer.id]);
    const listings = await listForUser(buyer.id, "invest");
    expect(listings.some((l) => l.symbol === "MAIN")).toBe(true);

    // Compliance: a Tier-1 / non-US recipient is blocked; an eligible one is allowed.
    const asset = (await getAsset(res.asset.id))!;
    const ineligible = await createUser(`inel-${seq++}-${Date.now()}@test.com`, "Inel");
    await getDb().execute("UPDATE identity_profiles SET tier = 1, jurisdiction = 'CA' WHERE user_id = ?", [ineligible.id]);
    expect((await checkTransfer(asset, ineligible.id)).allowed).toBe(false);
    expect((await checkTransfer(asset, buyer.id)).allowed).toBe(true);
  });

  it("issues a private placement via the whitelist profile (opt-in dimension)", async () => {
    const { issueAsset } = await import("../src/services/issuanceService");
    const { checkTransfer } = await import("../src/services/complianceService");
    const { getAsset } = await import("../src/services/tokenizationService");
    const { createUser } = await import("../src/services/authService");
    const { getDb } = await import("../src/db");

    const issuer = await makeIssuer();
    const alice = await createUser(`alice-${seq++}-${Date.now()}@test.com`, "Alice");
    const bob = await createUser(`bob-${seq++}-${Date.now()}@test.com`, "Bob");
    for (const id of [alice.id, bob.id]) {
      await getDb().execute("UPDATE identity_profiles SET tier = 2, jurisdiction = 'US' WHERE user_id = ?", [id]);
    }
    const res = await issueAsset({
      issuerUserId: issuer, kind: "security", name: "Private Round", symbol: "PRIV",
      complianceProfile: "security-whitelisted", whitelist: [alice.id], initialSupply: 100n,
    });
    const asset = (await getAsset(res.asset.id))!;
    expect((await checkTransfer(asset, alice.id)).allowed).toBe(true);
    const bobRes = await checkTransfer(asset, bob.id);
    expect(bobRes.allowed).toBe(false);
    expect(bobRes.reason).toMatch(/whitelist/i);
  });
});

describe("issuance console — kill-switch", () => {
  it("refuses to issue when the console is disabled", async () => {
    const { config } = await import("../src/config");
    const { issueAsset } = await import("../src/services/issuanceService");
    const issuer = await makeIssuer();
    (config as { ISSUANCE_CONSOLE_ENABLED: boolean }).ISSUANCE_CONSOLE_ENABLED = false;
    await expect(
      issueAsset({ issuerUserId: issuer, kind: "collectible", name: "Nope", initialSupply: 1n })
    ).rejects.toThrow();
    (config as { ISSUANCE_CONSOLE_ENABLED: boolean }).ISSUANCE_CONSOLE_ENABLED = true; // restore
  });
});
