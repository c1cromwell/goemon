/**
 * M3 — Decision knowledge graph (Agentic OS).
 *
 * Append-only kg_nodes + kg_edges. Writes on every agent run outcome, human gate
 * resolution, and CEO milestone sign-off. Neo4j Aura is the prod swap (same seam as
 * identityVaultService).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import type { GateDecision } from "../operations/operationsWorkflow";
import type { GateOutputClass } from "../operations/gatePolicy";
import type { AdminRole } from "../middleware/rbac";

export type KgNodeType =
  | "Decision"
  | "Strategy"
  | "Product"
  | "Launch"
  | "Incident"
  | "SupportIssue"
  | "Fix"
  | "Agent"
  | "Approval"
  | "Filing";

export type KgEdgeType =
  | "decided_by"
  | "rationale_for"
  | "gated_by"
  | "supersedes"
  | "relates_to"
  | "resulted_in";

export type KgScope = "corporate" | "product";

export interface KgNode {
  id: string;
  nodeType: KgNodeType;
  title: string;
  body: Record<string, unknown>;
  scope: KgScope;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface KgEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: KgEdgeType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KgGraphExport {
  nodes: KgNode[];
  edges: KgEdge[];
  exportedAt: string;
}

interface RawNode {
  id: string;
  node_type: KgNodeType;
  title: string;
  body_json: string;
  scope: KgScope;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

interface RawEdge {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: KgEdgeType;
  metadata_json: string;
  created_at: string;
}

const PRODUCT_SKILLS = new Set([
  "product-launch",
  "pdlc-launch",
  "cpo-launch",
  "marketplace-dd",
]);

function mapNode(r: RawNode): KgNode {
  return {
    id: r.id,
    nodeType: r.node_type,
    title: r.title,
    body: JSON.parse(r.body_json || "{}"),
    scope: r.scope,
    refType: r.ref_type,
    refId: r.ref_id,
    createdAt: r.created_at,
  };
}

function mapEdge(r: RawEdge): KgEdge {
  return {
    id: r.id,
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    edgeType: r.edge_type,
    metadata: JSON.parse(r.metadata_json || "{}"),
    createdAt: r.created_at,
  };
}

export function assertDecisionKgEnabled(): void {
  if (!config.DECISION_KG_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Decision knowledge graph is disabled");
  }
}

function scopeForSkill(skill: string, outputClass?: GateOutputClass | null): KgScope {
  if (outputClass === "product_launch") return "product";
  if (PRODUCT_SKILLS.has(skill)) return "product";
  return "corporate";
}

async function nodeExists(id: string): Promise<boolean> {
  const row = await getDb().queryOne<{ id: string }>("SELECT id FROM kg_nodes WHERE id = ?", [id]);
  return !!row;
}

async function insertNode(input: {
  id?: string;
  nodeType: KgNodeType;
  title: string;
  body?: Record<string, unknown>;
  scope?: KgScope;
  refType?: string;
  refId?: string;
}): Promise<KgNode> {
  const id = input.id ?? uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO kg_nodes (id, node_type, title, body_json, scope, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.nodeType,
      input.title,
      JSON.stringify(input.body ?? {}),
      input.scope ?? "corporate",
      input.refType ?? null,
      input.refId ?? null,
      now,
    ]
  );
  const row = await getDb().queryOne<RawNode>("SELECT * FROM kg_nodes WHERE id = ?", [id]);
  return mapNode(row!);
}

async function insertEdge(input: {
  fromNodeId: string;
  toNodeId: string;
  edgeType: KgEdgeType;
  metadata?: Record<string, unknown>;
}): Promise<KgEdge> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO kg_edges (id, from_node_id, to_node_id, edge_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.fromNodeId, input.toNodeId, input.edgeType, JSON.stringify(input.metadata ?? {}), now]
  );
  const row = await getDb().queryOne<RawEdge>("SELECT * FROM kg_edges WHERE id = ?", [id]);
  return mapEdge(row!);
}

async function ensureAgentNode(skill: string, scope: KgScope): Promise<string> {
  const id = `agent:${skill}`;
  if (await nodeExists(id)) return id;
  await insertNode({
    id,
    nodeType: "Agent",
    title: skill,
    scope,
    body: { skill },
  });
  return id;
}

async function ensureHumanActorNode(adminId: string, role: AdminRole): Promise<string> {
  const id = `human:${adminId}`;
  if (await nodeExists(id)) return id;
  await insertNode({
    id,
    nodeType: "Agent",
    title: `${role} (${adminId.slice(0, 8)})`,
    scope: "corporate",
    body: { adminId, role, kind: "human" },
  });
  return id;
}

/** Record an agent run outcome (executed | queued | rejected). */
export async function recordAgentRunDecision(input: {
  runId: string;
  workflowRun: string;
  skill: string;
  outcome: string;
  gateDecision: GateDecision;
  recommendation: unknown;
  confidence: number | null;
  reviewId?: string;
  outputClass?: GateOutputClass | null;
}): Promise<{ decisionNodeId: string } | null> {
  if (!config.DECISION_KG_ENABLED) return null;

  const scope = scopeForSkill(input.skill, input.outputClass ?? input.gateDecision.outputClass);
  const agentNodeId = await ensureAgentNode(input.skill, scope);
  const decisionNode = await insertNode({
    nodeType: "Decision",
    title: `${input.skill} · ${input.outcome}`,
    scope,
    refType: "agent_run",
    refId: input.runId,
    body: {
      workflowRun: input.workflowRun,
      outcome: input.outcome,
      gateDecision: input.gateDecision,
      recommendation: input.recommendation,
      confidence: input.confidence,
      reviewId: input.reviewId ?? null,
      outputClass: input.outputClass ?? input.gateDecision.outputClass ?? null,
    },
  });

  await insertEdge({
    fromNodeId: decisionNode.id,
    toNodeId: agentNodeId,
    edgeType: "decided_by",
    metadata: { outcome: input.outcome },
  });

  if (input.gateDecision.reason) {
    await insertEdge({
      fromNodeId: decisionNode.id,
      toNodeId: agentNodeId,
      edgeType: "rationale_for",
      metadata: { reason: input.gateDecision.reason },
    });
  }

  return { decisionNodeId: decisionNode.id };
}

/** Record a human gate resolution (approve / reject). */
export async function recordHumanApproval(input: {
  reviewId: string;
  runId: string;
  workflowRun: string;
  skill: string;
  actorAdminId: string;
  actorRole: AdminRole;
  humanDecision: "approve" | "reject";
  reason?: string;
  outputClass?: string | null;
}): Promise<{ approvalNodeId: string } | null> {
  if (!config.DECISION_KG_ENABLED) return null;

  const db = getDb();
  const prior = await db.queryOne<RawNode>(
    "SELECT * FROM kg_nodes WHERE ref_type = 'agent_run' AND ref_id = ? ORDER BY created_at DESC LIMIT 1",
    [input.runId]
  );

  const scope = scopeForSkill(input.skill, (input.outputClass as GateOutputClass | null) ?? null);
  const humanNodeId = await ensureHumanActorNode(input.actorAdminId, input.actorRole);
  const approvalNode = await insertNode({
    nodeType: "Approval",
    title: `${input.humanDecision} · ${input.skill}`,
    scope,
    refType: "agent_review",
    refId: input.reviewId,
    body: {
      workflowRun: input.workflowRun,
      humanDecision: input.humanDecision,
      reason: input.reason ?? null,
      actorRole: input.actorRole,
    },
  });

  await insertEdge({
    fromNodeId: approvalNode.id,
    toNodeId: humanNodeId,
    edgeType: "decided_by",
    metadata: { role: input.actorRole },
  });

  if (prior) {
    await insertEdge({
      fromNodeId: approvalNode.id,
      toNodeId: prior.id,
      edgeType: "gated_by",
      metadata: { reviewId: input.reviewId },
    });
    await insertEdge({
      fromNodeId: approvalNode.id,
      toNodeId: prior.id,
      edgeType: "resulted_in",
      metadata: { humanDecision: input.humanDecision },
    });
  }

  return { approvalNodeId: approvalNode.id };
}

/** Record a CEO milestone deploy sign-off. */
export async function recordMilestoneSignoff(input: {
  milestoneId: string;
  title: string;
  approverAdminId: string;
  approverRole: AdminRole;
  note?: string | null;
}): Promise<{ approvalNodeId: string } | null> {
  if (!config.DECISION_KG_ENABLED) return null;

  const humanNodeId = await ensureHumanActorNode(input.approverAdminId, input.approverRole);
  const approvalNode = await insertNode({
    nodeType: "Approval",
    title: `Milestone ${input.milestoneId} signed`,
    scope: "corporate",
    refType: "milestone",
    refId: input.milestoneId,
    body: {
      milestoneId: input.milestoneId,
      title: input.title,
      note: input.note ?? null,
      kind: "milestone_signoff",
    },
  });

  await insertEdge({
    fromNodeId: approvalNode.id,
    toNodeId: humanNodeId,
    edgeType: "decided_by",
    metadata: { milestoneId: input.milestoneId },
  });

  return { approvalNodeId: approvalNode.id };
}

export async function getNode(nodeId: string): Promise<KgNode | null> {
  assertDecisionKgEnabled();
  const row = await getDb().queryOne<RawNode>("SELECT * FROM kg_nodes WHERE id = ?", [nodeId]);
  return row ? mapNode(row) : null;
}

/** Nodes within N hops of a starting node (BFS, capped). */
export async function getNeighborhood(nodeId: string, maxHops = 2, limit = 100): Promise<KgGraphExport> {
  assertDecisionKgEnabled();
  const db = getDb();
  const visitedNodes = new Set<string>([nodeId]);
  const visitedEdges = new Set<string>();
  let frontier = [nodeId];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const nid of frontier) {
      const edges = await db.query<RawEdge>(
        `SELECT * FROM kg_edges WHERE from_node_id = ? OR to_node_id = ? ORDER BY created_at ASC LIMIT ?`,
        [nid, nid, limit]
      );
      for (const e of edges) {
        if (visitedEdges.has(e.id)) continue;
        visitedEdges.add(e.id);
        for (const id of [e.from_node_id, e.to_node_id]) {
          if (!visitedNodes.has(id)) {
            visitedNodes.add(id);
            next.push(id);
          }
        }
      }
    }
    frontier = next;
  }

  const nodeIds = [...visitedNodes];
  const placeholders = nodeIds.map(() => "?").join(",");
  const nodes = nodeIds.length
    ? (await db.query<RawNode>(`SELECT * FROM kg_nodes WHERE id IN (${placeholders})`, nodeIds)).map(mapNode)
    : [];
  const edgeIds = [...visitedEdges];
  const edges = edgeIds.length
    ? (
        await db.query<RawEdge>(
          `SELECT * FROM kg_edges WHERE id IN (${edgeIds.map(() => "?").join(",")})`,
          edgeIds
        )
      ).map(mapEdge)
    : [];

  return { nodes, edges, exportedAt: new Date().toISOString() };
}

export async function getGraphByWorkflowRun(workflowRun: string): Promise<KgGraphExport> {
  assertDecisionKgEnabled();
  const db = getDb();
  const seedNodes = (await db.query<RawNode>(
    `SELECT * FROM kg_nodes
     WHERE ref_id IN (SELECT id FROM agent_runs WHERE workflow_run = ?)
        OR ref_id IN (SELECT id FROM agent_reviews WHERE workflow_run = ?)
        OR body_json LIKE ?
     ORDER BY created_at ASC`,
    [workflowRun, workflowRun, `%\"workflowRun\":\"${workflowRun}\"%`]
  )).map(mapNode);

  if (seedNodes.length === 0) {
    return { nodes: [], edges: [], exportedAt: new Date().toISOString() };
  }

  const seedIds = seedNodes.map((n) => n.id);
  const ph = seedIds.map(() => "?").join(",");
  const edges = (
    await db.query<RawEdge>(
      `SELECT * FROM kg_edges WHERE from_node_id IN (${ph}) OR to_node_id IN (${ph})`,
      [...seedIds, ...seedIds]
    )
  ).map(mapEdge);

  const allIds = new Set<string>(seedIds);
  for (const e of edges) {
    allIds.add(e.fromNodeId);
    allIds.add(e.toNodeId);
  }
  const allIdList = [...allIds];
  const ph2 = allIdList.map(() => "?").join(",");
  const nodes = (
    await db.query<RawNode>(`SELECT * FROM kg_nodes WHERE id IN (${ph2})`, allIdList)
  ).map(mapNode);

  return { nodes, edges, exportedAt: new Date().toISOString() };
}

export async function exportGraph(opts: {
  scope?: KgScope;
  limit?: number;
} = {}): Promise<KgGraphExport> {
  assertDecisionKgEnabled();
  const limit = opts.limit ?? 500;
  const db = getDb();
  const nodes = (
    opts.scope
      ? await db.query<RawNode>(
          "SELECT * FROM kg_nodes WHERE scope = ? ORDER BY created_at DESC LIMIT ?",
          [opts.scope, limit]
        )
      : await db.query<RawNode>("SELECT * FROM kg_nodes ORDER BY created_at DESC LIMIT ?", [limit])
  ).map(mapNode);

  if (nodes.length === 0) {
    return { nodes: [], edges: [], exportedAt: new Date().toISOString() };
  }

  const ids = nodes.map((n) => n.id);
  const placeholders = ids.map(() => "?").join(",");
  const edges = (
    await db.query<RawEdge>(
      `SELECT * FROM kg_edges WHERE from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders})`,
      [...ids, ...ids]
    )
  ).map(mapEdge);

  return { nodes, edges, exportedAt: new Date().toISOString() };
}

export async function listRecentDecisions(limit = 25): Promise<KgNode[]> {
  assertDecisionKgEnabled();
  return (
    await getDb().query<RawNode>(
      "SELECT * FROM kg_nodes WHERE node_type = 'Decision' ORDER BY created_at DESC LIMIT ?",
      [limit]
    )
  ).map(mapNode);
}
