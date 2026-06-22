import { describe, it, expect } from "vitest";
import { generateSyntheticFraudGraph, graphFeatures } from "../src/eval/syntheticFraudGraph";

describe("synthetic fraud graph (SantanderAI gen-fraud-graph seam)", () => {
  it("generates a deterministic graph with fraud labels", () => {
    const g1 = generateSyntheticFraudGraph(7, 12);
    const g2 = generateSyntheticFraudGraph(7, 12);
    expect(g1.nodes.length).toBe(12);
    expect(g1).toEqual(g2);
    expect(g1.fraudRate).toBeGreaterThan(0);
  });

  it("extracts graph features for seq-v0 stand-in", () => {
    const g = generateSyntheticFraudGraph(1, 8);
    const f = graphFeatures(g, g.nodes[0]!.id);
    expect(f.degree).toBeGreaterThanOrEqual(0);
    expect(f.sharedDeviceLinks).toBeGreaterThanOrEqual(0);
  });
});
