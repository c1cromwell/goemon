-- Phase 20 — key-vault custody (closes invariant m / audit C-1).
--
-- Per-user Hedera Ed25519 keys are no longer stored as plaintext DER. New keys
-- are wrapped (AES-256-GCM via keyVaultService, real KMS in production) and stored
-- in private_key_enc; the legacy plaintext private_key_hex is nulled on backfill
-- (`npm run encrypt-keys`) and never written for new accounts. A row is read via
-- hederaService.loadSignerKey(), which unwraps private_key_enc or — for a legacy
-- row — uses private_key_hex once and lazily re-encrypts it.
--
-- did_keys.private_jwk is wrapped in place (the gcm.v1. prefix distinguishes a
-- wrapped value from legacy raw JSON), so it needs no column change here.

ALTER TABLE hedera_accounts ADD COLUMN private_key_enc TEXT;
