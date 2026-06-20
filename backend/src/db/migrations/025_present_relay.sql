-- Phase 10 (iOS wallet) — OID4VP token relay.
--
-- A native wallet POSTs the signed VP to /api/present and the 90s scoped token is
-- returned TO THE WALLET. To deliver it to the requesting agent (which never sees the
-- wallet's response), the token is parked here keyed by the single-use nonce the agent
-- minted at challenge time. The agent then fetches it once via GET /api/present/token/:nonce.
--
-- The nonce is the correlation secret (long-random, single-use, bound to the agent's
-- client_did at challenge). The relay entry is single-fetch + short-lived (expires_at),
-- so the token is exposed for one handoff only.

-- (Named present_relay_tokens to avoid the legacy pending_tokens table from 001.)
CREATE TABLE IF NOT EXISTS present_relay_tokens (
  nonce        TEXT PRIMARY KEY,
  client_did   TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_type   TEXT NOT NULL DEFAULT 'Bearer',
  expires_in   INTEGER NOT NULL,
  scope        TEXT NOT NULL DEFAULT '[]',
  jti          TEXT NOT NULL,
  fetched      INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
