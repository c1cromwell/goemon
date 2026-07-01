# Phase 28 — RWA Expansion

**Status: DESIGN (not built).** Deepens the tokenization core — the wedge — with the highest-value
real-world-asset products from the competitive review
(`docs/business/RWA-NEOBANK-COMPETITIVE-REVIEW.md`). Extends Phase 8 (marketplace, compliance-gated
ledger holdings) and Phase 18.6 (tokenized equities) rather than starting new rails.

**Governing lesson:** *be the distribution / wallet / ledger layer, not the issuer.* Goemon holds the
token, mirrors the position, reconciles it (the transfer-agent pattern it already has), and **partners
the regulated stack** (fund wrapper / BD / ATS / transfer agent / custodian). Ramp: **A → B → C**.
⚖ securities-counsel-gated.

---

## 1. Product menu (prioritized) — model, gate, ramp

| # | Product | Model to follow | Partner / gate | Ramp |
|---|---|---|---|---|
| 1 | **Tokenized-treasury yield** — "cash that earns" (retail wedge) | Ondo **USDY** (Reg S yieldcoin) / Franklin **BENJI** (’40-Act MMF token) — distribute, don't issue | Registered fund + custodian; Reg S distribution; reconciliation = transfer-agent pattern | **A→B** |
| 2 | **Private-credit yield** (higher-yield tier) | **Maple** `syrupUSDC` (~8% APY) — wrap the composable token, don't underwrite | Wrap/partner; risk disclosure | **B** |
| 3 | **Issuance-as-a-service** — partners issue compliant tokens on Goemon rails | **Tokeny ERC-3643 + ONCHAINID** (adopt the standard) + **Securitize-style** BD/TA/ATS (partner) | Standard is license-free (A); primary/secondary needs partner BD/ATS + transfer agent | **A→C** |
| 4 | **Tokenized funds / equities** | Centrifuge **SPXA** index / Dinari-style 1:1 equities (Phase-18.6 seam) | Reg S / index license; 1:1 equity needs issuer + BD/TA/custodian/ATS | **B→C** |
| 5 | **Tokenized real estate** | RealT LLC-per-property + rent-in-stablecoin — surface via an **issuer partner**, don't originate deeds | Reg D (accredited) / Reg S; per-entity overhead | **B→C** |

## 2. Architecture (reuse)
- **Assets as ledger-derived holdings** — each asset its own ledger currency code (Phase 8). New products
  are new asset **kinds** + issuer seams, not new ledgers.
- **Compliance Module** (Phase 8: tier / jurisdiction / holder-cap) + **ERC-3643** transfer rules → adopt
  **ONCHAINID** for the identity claim (license-free, Phase A).
- **Swappable issuer seams** (like Phase-18.6 `EQUITY_ISSUER`): `TREASURY_YIELD_ISSUER`
  (ondo/franklin/libeara), `CREDIT_ISSUER` (maple), `REALESTATE_ISSUER` (realt-style partner) — simulated
  default, prod-fatal; the licensed provider is the swap.
- **Reconciliation** (Phase 20 `reconciliationService`) is the transfer-agent invariant — chain as record,
  reconciled to the authoritative ledger daily. **This is the Phase-A design win** the review highlights.
- **Yield/dividends** reuse Phase-18.6 `corporateActionService` (per-holder idempotent pro-rata); redemption
  reuses `redemptionService` (burn → deliver).
- **Distribution, not issuance:** for products 1/2 Goemon credits the *delivered* token (like the on-ramp
  posture) — the licensed issuer takes subscriptions under its own wrapper.

## 3. Staged build
- **28.0 — Tokenized-treasury yield (product #1):** `treasuryYield` asset kind + `TREASURY_YIELD_ISSUER`
  seam (simulated), distribute as "cash that earns," reconciled; `RWA_TREASURY_YIELD_ENABLED` (prod-fatal).
  Builds directly on the existing Treasury/Earn surface.
- **28.1 — Private-credit yield (product #2):** wrap a Maple-style composable token as a higher-yield tier.
- **28.2 — Issuance-as-a-service (product #3):** ONCHAINID + ERC-3643 issuance flow for partner issuers;
  primary issuance behind a partner BD/TA.
- **28.3 — Funds / equities (product #4):** extend Phase-18.6 to index funds / broader 1:1 equities.
- **28.4 — Real estate (product #5):** issuer-partner surface (no deed origination).

## 4. Compliance gate (⚖)
Distribution of a partner's Reg S / registered token (A→B); private-credit wrap disclosure (B); issuance /
secondary venue needs partner **BD / ATS / transfer agent** (C); real estate is accredited (Reg D) +
per-entity legal. **EU/MiCA-first arbitrage:** ship the boldest features where a CASP/MiCA path exists
before the US securities path. **Avoid:** issuing the fund wrapper, underwriting credit, originating deeds,
or becoming a "tokenization dev-shop" that disclaims compliance — the moat is the regulated-posture,
non-custodial operator that *takes on* the compliance burden.

## 5. Acceptance (when built)
Distribute a tokenized-treasury-yield token → user holds it as a ledger-derived position → yield accrues
per-holder idempotently → position reconciles to chain daily → redeem back to cash → all balanced,
compliance-gated (tier/jurisdiction/holder-cap), append-only audited, with the licensed issuer as the
security's issuer of record and Goemon as the non-custodial distribution + ledger layer.
