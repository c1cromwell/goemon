-- Phase 5 — Hedera account keys (prototype/dev only).
--
-- Production note: private_key_hex stores the DER-encoded ED25519 private key
-- plaintext. This is acceptable for the TypeScript prototype only. Before any
-- staging deployment, replace with a KMS-wrapped value (same pattern as
-- did_keys.private_jwk — see C-1 in the security audit notes).
--
-- usdc_associated tracks whether the HTS USDC token has been associated with
-- the account (required before receiving USDC on Hedera).
--
-- network records which Hedera network the account lives on (testnet / mainnet).

ALTER TABLE hedera_accounts ADD COLUMN private_key_hex TEXT;
ALTER TABLE hedera_accounts ADD COLUMN usdc_associated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hedera_accounts ADD COLUMN network         TEXT    NOT NULL DEFAULT 'testnet';
