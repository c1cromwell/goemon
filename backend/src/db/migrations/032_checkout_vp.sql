-- Phase 21 — login-less merchant checkout via Verifiable Presentation.
--
-- At a merchant checkout, instead of redirecting the customer to a hosted login,
-- the customer's device presents a VC-backed Verifiable Presentation that proves
-- the holder (→ their Goemon user) and authorizes paying ONE specific payment
-- intent. The challenge nonce is bound to that intent here so a presentation
-- minted for intent A can never be replayed to pay intent B.
--
-- We reuse the existing presentation_nonces table (the agent flow leaves intent_id
-- NULL; the checkout flow sets it). The signature-first VP verification, single-use
-- nonce, replay guard (vp_presentations.vp_hash), VC revocation, and holder-binding
-- are all the same battle-tested checks as the Phase-7 agent path.

ALTER TABLE presentation_nonces ADD COLUMN intent_id TEXT;
