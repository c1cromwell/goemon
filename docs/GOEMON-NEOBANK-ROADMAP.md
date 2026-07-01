# Goemon — Neobank + RWA Roadmap

**Thesis:** Goemon launches as a **tokenization-first, non-custodial** product (the Phase-A MVP,
already built) and layers on the neobank feature set that Chime / Revolut / Robinhood have proven
— **without displacing tokenization as the wedge**. Every added feature slots into the existing
**A → B → C compliance ramp** (`docs/business/CORPORATE-STRUCTURE.md`): A = non-custodial software,
B = partnered (BaaS + FinCEN MSB), C = licensed (MTLs / broker-dealer / transfer agent).

Competitor + RWA teardown (cited, current): **`docs/business/RWA-NEOBANK-COMPETITIVE-REVIEW.md`**.
The single most important lesson from that review: **be the distribution / wallet / ledger layer,
not the issuer** — adopt the license-free compliance standard (ERC-3643 + ONCHAINID) and *partner*
the regulated stack (BD / ATS / transfer agent / fund wrapper) rather than build it. Ondo *bought* a
broker-dealer; Franklin pairs infra with a licensed fund manager; Goemon's non-custodial + ledger⇄chain
reconciliation design already fits "hold the token, mirror the position, partner the issuer."

---

## 1. What already exists (reposition — do not rebuild)

Most requested feature lines exist as **simulated Stage-1 seams** with prod-fatal kill-switches
(see `CLAUDE.md` build status). The roadmap **repositions** them under a competitor-framed
narrative and hardens them via partners; it does not restart them.

| Feature line | Answers | Today (phase / status) |
|---|---|---|
| High-Yield Savings | Chime HYSA | **Earn / Treasury (ATB)** built (Phase 19/Treasury sim); tokenized-yield model, not a bank APY |
| Kids & Teens | Chime / Greenlight | **Phase 22 Goemon Starter** built as sim stubs (households, teen debit, savings/goals, gamification, credit-builder, custodial) |
| Trading — crypto & stocks | Robinhood | **Phase 17** trading sim (Stage 1–2) + **Phase 18.6** tokenized equities sim |
| Cards (debit) | Chime / Revolut | **Phase 19.4** debit-card lifecycle sim (`cardService`) |
| Bank rails / on-off-ramp / bill-pay / lending | Chime / Revolut | **Phase 19** built as sim seams |
| Payments | Revolut / Cash App | **Phase 21 Goemon Pay** (merchant intents + escrow) sim |
| SmartChat (conversational money) | — (differentiator) | **Phase 6** built + **Phase 15** human-gated agent ops built |
| Tokenized RWA marketplace | Securitize / RealT | **Phase 8** built (Invest/Collect), compliance-gated ledger holdings |

## 2. What is genuinely net-new (this roadmap adds it)

Four new phases, design-stubbed now, built in later waves:

| New phase | What | Reuses |
|---|---|---|
| **Phase 25 — SMB / Business Banking** | Business entity accounts, checking/savings, loans, payments/payroll/invoicing | Ledger, Phase-19 bank rails + cards, Phase-21 Pay |
| **Phase 26 — Agentic Trading & Portfolio Mgmt** | Agent-driven trading + portfolio management on SmartChat + the Phase-15 runner (advise → gate → deterministic execute) | Phase 6/15/17, new scoped MCP tools |
| **Phase 27 — Virtual & Credit Cards** | Virtual cards, a consumer **credit** card, and **agent-issued programmable cards** (per-agent limits, burn-after-use) | Phase 19.4 `cardService` / `CardProcessor` |
| **Phase 28 — RWA Expansion** | Tokenized treasuries, private credit, real estate, tokenized funds/equities, issuance-as-a-service | Phase 8 / 18.6 marketplace + compliance + reconciliation |

Design docs: `docs/PHASE-25-SMB-BUSINESS-BANKING.md`, `docs/PHASE-26-AGENTIC-TRADING-PORTFOLIO.md`,
`docs/PHASE-27-VIRTUAL-CREDIT-CARDS.md`, `docs/PHASE-28-RWA-EXPANSION.md`.

## 3. RWA products to offer (from the competitive review)

Prioritized menu; each tagged with the model it follows and its compliance gate. **Goemon holds the
token, mirrors the position, and partners the issuer** — it does not become the fund/BD/TA.

| # | Product | Model to follow | Gate | Ramp |
|---|---|---|---|---|
| 1 | **Tokenized-treasury yield** ("cash that earns") — the #1 retail wedge | Ondo **USDY** (Reg S yieldcoin) / Franklin **BENJI** (’40-Act MMF token) — distribute, don't issue the wrapper | Reg S distribution / partner the registered fund + custodian; Goemon's reconciliation = the transfer-agent pattern | A→B |
| 2 | **Private-credit yield** (higher-yield savings tier) | **Maple** `syrupUSDC` (~8% APY) — wrap the composable token, don't underwrite | Partner/wrap; disclosure | B |
| 3 | **Security-token issuance-as-a-service** | **Tokeny ERC-3643 + ONCHAINID** (adopt, license-free) + **Securitize-style** BD/TA/ATS (partner) | Standard is Phase A; primary/secondary needs partner BD/ATS + transfer agent | A→C |
| 4 | **Tokenized funds / equities** | Centrifuge **SPXA** index / Dinari-style 1:1 equities (Goemon's Phase 18.6 seam) | Reg S / index license; 1:1 equity needs issuer + BD/TA/custodian/ATS | B→C |
| 5 | **Tokenized real estate** | RealT LLC-per-property + rent-in-stablecoin — surface via an **issuer partner**, don't originate deeds | Reg D (accredited) / Reg S; per-entity legal overhead | B→C |

**Patterns to steal (Phase A, no license):** transfer-agent pattern (Franklin — chain as record,
reconciled to authoritative ledger; Goemon already has it); composable-but-compliant wrappers
(Securitize sToken / Centrifuge deRWA → maps to Goemon's compliance-gated holdings + Phase 18.6);
deposit-token vs stablecoin framing (Kinexys); **EU/MiCA-first regulatory arbitrage** (Robinhood
shipped tokenized stocks in the EU first). **Avoid / partner:** the US securities stack, a bank-grade
fiat stablecoin (partner Circle/SG-Forge), underwriting credit, originating deeds, and the commoditized
"RWA tokenization dev-shop" layer (Blockchain App Factory / BlockRidge disclaim the compliance burden —
the opposite of Goemon's moat).

## 4. Phased rollout (waves on the compliance ramp)

**Wave 0 — MVP launch (ship now, Phase A).** The built tokenization product: non-custodial wallet,
DID/VC identity, SmartChat, Invest/Collect marketplace, external agents, internal ops. No customer
fiat custody, no MSB. Revenue: software/tokenization fees. *(Unchanged by this roadmap.)*

**Wave 1 — first post-MVP (the user's chosen priorities).** Runs in parallel where gates differ:
- **RWA deepening (Phase 28)** — lead with **tokenized-treasury yield** (product #1): distribute a
  yieldcoin / MMF token as "cash that earns," reusing Phase-8 holdings + reconciliation. Adopt
  ERC-3643 + ONCHAINID as the issuance standard (Phase A). *Gate: Reg S distribution / fund + custodian
  partner (B).*
- **Trading + Agentic portfolio (Phase 17 + 26)** — harden the trading seam and add agent-driven
  trading/portfolio management (advise → gate → execute). *Gate: broker-dealer / clearing + market-data
  partner (C); agentic layer is Phase A software on top.*
- **SMB start (Phase 25)** — business entity accounts + payments first (reuse Goemon Pay + bank rails).
  *Gate: BaaS partner + FinCEN MSB (B).*
- **Consumer-banking fast-follow** — HYSA (product #1/#2), debit + **virtual cards (Phase 27)**, teens
  (Phase 22) — mostly built; hardens via the same BaaS partner as SMB. *Gate: BaaS + MSB (B).*

**Wave 2 — licensed / own-rails (Phase C).** Consumer **credit** card (Phase 27), 1:1 tokenized
equities + secondary resale venue (Phase 18.6 → ATS), real-estate issuance (Phase 28 #5), own MTLs /
broker-dealer / transfer-agent registration where unit economics justify recapturing margin.

## 5. Compliance-gate summary

| Wave | Unlocks | Hard gate |
|---|---|---|
| 0 | Tokenization MVP (software) | Entity + AML policy + terms (done) |
| 1 | Treasury yield, SMB payments, trading, consumer banking/cards, agentic PM | **BaaS partner + FinCEN MSB**; broker-dealer/market-data partner for live trading; fund + custodian for treasury yield |
| 2 | Credit card, tokenized-equity venue, real-estate issuance, own rails | **State MTLs / broker-dealer / ATS / transfer-agent registration**; issuer/placement partners |

> This roadmap is strategy, not legal advice. Every gate must be confirmed with fintech/securities
> counsel before launch (⚖). Figures and competitor facts are cited in
> `docs/business/RWA-NEOBANK-COMPETITIVE-REVIEW.md` (with uncertainty flags).
