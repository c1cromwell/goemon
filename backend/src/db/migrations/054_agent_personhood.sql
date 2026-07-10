-- Feature A — Agent-Personhood Attestation.
-- Records a JWKS-verifiable "a KYC-verified human authorized this agent" attestation,
-- minted at grant time and consulted by presentationService before a scoped token is
-- issued. One active attestation per (user, agent); re-granting replaces it.
CREATE TABLE IF NOT EXISTS agent_personhood_attestations (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  agent_did         TEXT NOT NULL,
  wallet_did        TEXT,
  credential_id     TEXT,               -- the KYC credential that anchors personhood
  personhood_level  TEXT NOT NULL,      -- 'verified_human'
  scope             TEXT NOT NULL,      -- JSON array of authorized scope strings
  attestation_jwt   TEXT NOT NULL,      -- signed issuer JWT (verifiable against /.well-known/jwks.json)
  active            INTEGER NOT NULL DEFAULT 1,
  issued_at         TEXT NOT NULL,
  revoked_at        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personhood_user_agent
  ON agent_personhood_attestations (user_id, agent_did);
