-- Phase 2 — DID key persistence.
-- Stores the platform issuer RS256 keypair(s) so they survive server restarts.
-- Multiple rows support key rotation: old keys are kept with a retired_at timestamp
-- so in-flight tokens remain verifiable during the rotation window.
-- All rows use IF NOT EXISTS so this script is safe to re-run.

CREATE TABLE IF NOT EXISTS did_keys (
  kid         TEXT PRIMARY KEY,            -- UUID v4; used as the JWKS kid
  algorithm   TEXT NOT NULL DEFAULT 'RS256',
  private_jwk TEXT NOT NULL,              -- Phase 20: keyVault-wrapped (gcm.v1. prefix); legacy rows hold raw JSON until wrapped on load
  public_jwk  TEXT NOT NULL,              -- JSON-stringified JWK (public)
  active      INTEGER NOT NULL DEFAULT 1, -- 1 = current signing key; 0 = retired (verification only)
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  retired_at  TEXT                         -- set when rotated; key stays active for verification until this passes
);
