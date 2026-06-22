/**
 * Synthetic fraud graph fixtures — inspired by SantanderAI/gen-fraud-graph (Apache-2.0).
 * Generates benchmark entity graphs for fraud-engine seq-v0 / Identity Vault eval.
 * Optional: run the upstream Python generator when available:
 *   pip install git+https://github.com/SantanderAI/gen-fraud-graph
 */

export interface FraudGraphNode {
  id: string;
  kind: "user" | "device" | "account" | "merchant";
  label?: string;
  isFraud?: boolean;
}

export interface FraudGraphEdge {
  from: string;
  to: string;
  kind: "owns" | "sent_to" | "shared_device" | "linked";
  weight?: number;
}

export interface SyntheticFraudGraph {
  nodes: FraudGraphNode[];
  edges: FraudGraphEdge[];
  fraudRate: number;
  seed: number;
}

/** Deterministic small graph for unit tests and shadow eval. */
export function generateSyntheticFraudGraph(seed = 42, nodeCount = 20): SyntheticFraudGraph {
  const nodes: FraudGraphNode[] = [];
  const edges: FraudGraphEdge[] = [];
  let rng = seed;

  const next = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  for (let i = 0; i < nodeCount; i++) {
    const kind = i % 4 === 0 ? "device" : i % 3 === 0 ? "merchant" : "user";
    const isFraud = next() < 0.15;
    nodes.push({ id: `${kind}-${i}`, kind: kind as FraudGraphNode["kind"], isFraud });
  }

  for (let i = 0; i < nodeCount - 1; i++) {
    const j = Math.floor(next() * nodeCount);
    edges.push({
      from: nodes[i]!.id,
      to: nodes[j]!.id,
      kind: next() < 0.3 ? "shared_device" : "sent_to",
      weight: Math.floor(next() * 5) + 1,
    });
  }

  const fraudNodes = nodes.filter((n) => n.isFraud).length;
  return {
    nodes,
    edges,
    fraudRate: fraudNodes / nodes.length,
    seed,
  };
}

/** Feature vector for a node — degree + shared-device count (graph ML stand-in). */
export function graphFeatures(graph: SyntheticFraudGraph, nodeId: string): { degree: number; sharedDeviceLinks: number } {
  const out = graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
  const sharedDeviceLinks = graph.edges.filter(
    (e) => e.kind === "shared_device" && (e.from === nodeId || e.to === nodeId)
  ).length;
  return { degree: out.length, sharedDeviceLinks };
}
