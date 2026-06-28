-- M3 — Decision knowledge graph (Agentic OS corporate + product decisions).

CREATE TABLE IF NOT EXISTS kg_nodes (
  id           TEXT PRIMARY KEY,
  node_type    TEXT NOT NULL,
  title        TEXT NOT NULL,
  body_json    TEXT NOT NULL DEFAULT '{}',
  scope        TEXT NOT NULL DEFAULT 'corporate',
  ref_type     TEXT,
  ref_id       TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_ref ON kg_nodes(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_scope ON kg_nodes(scope, created_at);

CREATE TABLE IF NOT EXISTS kg_edges (
  id            TEXT PRIMARY KEY,
  from_node_id  TEXT NOT NULL,
  to_node_id    TEXT NOT NULL,
  edge_type     TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON kg_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_type ON kg_edges(edge_type);
