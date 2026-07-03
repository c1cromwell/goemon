/**
 * Phase 29 Slice 1 — asset-type registry.
 *
 * Proves (a) the registry knows the five current kinds, and (b) `isSecurityKind`
 * reproduces the previous inline rule
 * (`kind === "security" || kind === "equity" || token_standard === "erc3643"`) exactly.
 * Pure — no DB.
 */

import { describe, it, expect } from "vitest";
import {
  getAssetType,
  isKnownAssetKind,
  listAssetTypes,
  isSecurityKind,
  defaultComplianceProfile,
} from "../src/services/assetTypeRegistry";

describe("asset-type registry", () => {
  it("registers the current kinds, all enabled", () => {
    const kinds = listAssetTypes().map((t) => t.kind).sort();
    expect(kinds).toEqual(["collectible", "commodity", "equity", "gaming", "real_estate", "royalty", "security", "treasury"]);
    for (const k of kinds) expect(isKnownAssetKind(k)).toBe(true);
    expect(isKnownAssetKind("does-not-exist")).toBe(false);
    expect(getAssetType("collectible")?.defaultTokenStandard).toBe("hts");
    expect(getAssetType("security")?.defaultTokenStandard).toBe("erc3643");
  });

  it("isSecurityKind matches the previous inline rule for every combination", () => {
    // Old rule: kind security|equity OR tokenStandard erc3643.
    const oldRule = (kind: string, ts: string) => kind === "security" || kind === "equity" || ts === "erc3643";
    const kinds = ["security", "equity", "treasury", "collectible", "gaming", "unknown-kind"];
    const standards = ["hts", "erc3643"];
    for (const kind of kinds) {
      for (const ts of standards) {
        expect(isSecurityKind(kind, ts)).toBe(oldRule(kind, ts));
      }
    }
    // Spot-check the important ones explicitly.
    expect(isSecurityKind("collectible", "hts")).toBe(false);
    expect(isSecurityKind("collectible", "erc3643")).toBe(true); // erc3643 makes anything a security
    expect(isSecurityKind("treasury", "hts")).toBe(false); // treasury is a security only via its standard
    expect(isSecurityKind("treasury", "erc3643")).toBe(true);
    expect(isSecurityKind("security", "hts")).toBe(true); // intrinsic
  });

  it("exposes a default compliance profile per kind", () => {
    expect(defaultComplianceProfile("collectible")).toBe("exempt-basic");
    expect(defaultComplianceProfile("gaming")).toBe("exempt-basic");
    expect(defaultComplianceProfile("security")).toBe("security-erc3643");
    expect(defaultComplianceProfile("equity")).toBe("security-erc3643");
    expect(defaultComplianceProfile("unknown")).toBe("exempt-basic");
  });
});
