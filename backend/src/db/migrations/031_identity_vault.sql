-- Identity Vault prototype — relationship graph in SQLite (Neo4j Aura swap in prod).

CREATE TABLE IF NOT EXISTS identity_vault_edges (
  id              TEXT PRIMARY KEY,
  from_user_id    TEXT NOT NULL,
  to_user_id      TEXT NOT NULL,
  relationship    TEXT NOT NULL CHECK (relationship IN ('TRANSACTED_WITH', 'SHARES_DEVICE', 'SHARES_BENEFICIARY', 'BOUND_WALLET')),
  weight_minor    TEXT NOT NULL DEFAULT '0',
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_user_id, to_user_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_iv_edges_from ON identity_vault_edges(from_user_id, relationship);
CREATE INDEX IF NOT EXISTS idx_iv_edges_to ON identity_vault_edges(to_user_id, relationship);
