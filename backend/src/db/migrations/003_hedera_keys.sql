-- Phase 5 — Hedera account keys (prototype/dev only).
--
-- Production note: private_key_hex originally stored the DER-encoded ED25519
-- private key as plaintext. As of Phase 20 (migration 013) keys are wrapped via
-- keyVaultService and stored in private_key_enc; private_key_hex is nulled on
-- backfill and never written for new accounts (closes audit C-1 / invariant m).
--
-- usdc_associated tracks whether the HTS USDC token has been associated with
-- the account (required before receiving USDC on Hedera).
--
-- network records which Hedera network the account lives on (testnet / mainnet).

ALTER TABLE hedera_accounts ADD COLUMN private_key_hex TEXT;
ALTER TABLE hedera_accounts ADD COLUMN usdc_associated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hedera_accounts ADD COLUMN network         TEXT    NOT NULL DEFAULT 'testnet';
