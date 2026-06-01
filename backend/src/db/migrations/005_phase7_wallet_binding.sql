-- Phase 7 — Holder binding for Verifiable Presentations.
--
-- A user's VC subject is a platform DID (did:web:bankai.com:users:<id>), but a
-- Verifiable Presentation is signed by the wallet's own did:key. To prevent a
-- stolen (bearer) VC JWT from being presented by a different wallet, we bind the
-- wallet's did:key to the credential. verifyPresentation requires the VP signer
-- (vp.iss) to equal this bound wallet DID — no binding, no access.
--
-- Portable additive column (works on SQLite and Postgres). The migration runner
-- baselines this if the column already exists.

ALTER TABLE credentials ADD COLUMN wallet_did TEXT;
