# Goemon — Tokenization Master Plan

**One engine, many verticals.** The future architecture for Goemon as a universal, compliant,
non-custodial tokenization platform for the entire industry — *without* displacing the MVP.

> **Keep it simple first.** The MVP ships as-is (collectibles). Nothing here changes that. This is
> the future map: the top 15 focus areas — platform capabilities **and** asset-class verticals —
> most of which reuse the engine Goemon **already has**. Strategy, not legal advice; every regulated
> step is ⚖ counsel-gated. Companion: `docs/PHASE-28-RWA-EXPANSION.md`,
> `docs/business/RWA-NEOBANK-COMPETITIVE-REVIEW.md`, `docs/business/CORPORATE-STRUCTURE.md` (A→B→C ramp).

---

## 1. The thesis — don't build 15 products; build ONE platform + N profiles

Goemon's tokenization engine is **already asset-agnostic**. That is the whole game: the cost of a
new asset class is a *profile*, not a *rewrite*. Concretely, these primitives are kind-agnostic today:

| Primitive | What it does | File |
|---|---|---|
| **Asset = ledger currency code** | Every asset is `ASSET:<id>`; supply/holdings tracked as a distinct currency so the ledger balances money **and** units atomically | `services/ledgerService.ts`, `services/tokenizationService.ts` (AssetKind, `createAsset`) |
| **Compliance Module** | `checkTransfer`: identity registry + min-tier (all kinds) + jurisdiction allow-list + holder-cap (auto-applied only when the asset `isSecurity`) | `services/complianceService.ts:32-64` |
| **Primary issuance (escrow)** | `subscribe → close/refund`: cash into escrow, one atomic journal delivers units from treasury + releases to issuer + collects fee | `services/marketplaceService.ts` |
| **Secondary trading** | `placeOrder` buy/sell as one atomic cash+asset+fee journal (compliance-gated on the buyer) | `services/marketplaceService.ts` |
| **Transfer** | P2P asset move; securities route through compliance, others check tier only | `services/marketplaceService.ts` |
| **Corporate actions** | `distributeDividend`/`declareCorporateAction`: pro-rata by on-chain balance, one idempotent journal per holder; splits | `services/corporateActionService.ts` |
| **Redemption** | `redeem`: burn units → deliver proceeds, one atomic journal; **swappable issuer** seam | `services/redemptionService.ts` |
| **Listings + pricing** | Versioned insert-only lifecycle (staging→soft→public→paused→delisted); price source + staleness | `services/listingService.ts`, `services/pricingService.ts` |
| **Kill-switch pattern** | `<VERTICAL>_ENABLED` + `<VERTICAL>_PROVIDER` + prod-fatal guard | `config.ts`, `productionFatals()` |

**So adding a vertical = new `AssetKind` value + a compliance profile + domain metadata + an optional
issuer seam + a config flag.** The moat is this engine's four properties, which no single-asset
competitor combines: **non-custodial · compliance-as-code · agent-native · ledger⇄chain reconciled.**

**The strategic consequence:** the highest-leverage thing to build after the MVP is **not** any one
vertical — it's the **platform layer (P1–P3, P6)** that turns every future asset class into "onboard
a profile." Build the engine once; the 9 verticals become configuration.

---

## 2. What you already have / already planned (so "new" is clear)

- **LIVE (MVP):** `collectible` + `gaming` (HTS, tier-only, free transfer).
- **Prototype (ERC-3643, `*_ENABLED` prod-fatal):** `security`, `equity` (Phase 18.6, Dinari-style
  1:1 equities), `treasury` (Ondo-style yield).
- **Planned — Phase 28 RWA Expansion:** tokenized-treasury yield, private credit, real estate, funds/
  indices, issuance-as-a-service. (Real estate = the Lofty/RealT lane you already named.)

**The 15 below go beyond these** — the land/farmland/commodities/SMB/royalties/receivables verticals
and the platform capabilities (issuance console, compliance-as-a-service, management tools, employee
equity, capital formation, secondary/ATS) you flagged.

---

## 3. The Top 15 — mini business-case each

Format per item: **what · why/underserved · model to follow · Goemon reuse · compliance gate · ramp.**

### Part A — Platform capabilities (what makes it "one-size-fits-all")

> **STATUS — Part A is BUILT (P1–P6, prototype seams, each behind a prod-fatal kill-switch).**
> The engine layer from §6 is real: an issuer can create a compliant token, raise capital on it,
> grant equity to employees, and holders can trade it on a secondary book and track everything —
> all on the one asset-agnostic engine.
> - **P1** issuance console — `issuanceService` + `assetTypeRegistry` + `complianceProfiles`; routes `/api/issuer/*`; UI `/issuer`. (`ISSUANCE_CONSOLE_ENABLED`)
> - **P2** compliance-as-a-service — `complianceProfiles` (composable dimensions incl. real **accreditation**, whitelist, lockup); admin `/api/admin/identities/:id/accreditation`.
> - **P3** holder cockpit — `portfolioService` (positions/distributions/tax summary); routes `/api/portfolio/*`; UI `/portfolio`.
> - **P4** employee equity comp — `equityCompService` (grants, cliff+linear vesting, 83(b), option exercise, cap table); `/api/equity/*`; UI `/equity`. (`EQUITY_COMP_ENABLED`) Ties to `docs/legal/EQUITY-INCENTIVE-PLAN.md`.
> - **P5** capital formation — `capitalRaiseService` (offerings, escrowed commitments, settle/refund at target, Reg CF/D/A + accreditation gate); `/api/raise/*`; UI `/raise`. (`CAPITAL_RAISE_ENABLED`)
> - **P6** secondary market — `secondaryMarketService` (peer-to-peer limit order book + matching engine, escrow, compliance-checked fills); `/api/market/*`; UI `/exchange`. (`SECONDARY_MARKET_ENABLED`)
>
> **First onboarded vertical: Real estate** (land / farmland / apartments) — added as an
> `assetTypeRegistry` entry + property metadata, **zero engine changes** (`npm run seed:realestate`).
> This is the proof of §6: a new vertical is "onboard a profile," not a project.

**P1 — Self-serve compliant issuance console ("tokenize anything").**
- *What:* a guided console where any issuer creates a compliant token in minutes — pick asset kind,
  jurisdiction rules, holder cap, transfer restrictions, docs, price source; mint to treasury; list.
- *Why:* this is the product that converts the other 14 into "onboard a profile," and it's the
  industry's real bottleneck (issuance is slow, bespoke, lawyer-heavy).
- *Model:* Tokeny / Securitize self-serve issuance.
- *Reuse:* `tokenizationService.createAsset` + `listingService` lifecycle + Compliance Module —
  already the whole flow; needs a UI/console + a **compliance-profile registry** (see P2).
- *Gate:* the console is Phase-A software; what the issuer *sells* carries its own gate.
- *Ramp:* **A** (build) → per-asset **B/C**.

**P2 — Compliance-as-a-service (programmable transfer rules).**
- *What:* extend the Compliance Module beyond tier/jurisdiction/holder-cap to a library of
  **reusable per-asset compliance profiles**: accreditation checks, **lockups (Reg D 1-yr)**,
  max-investor (§12(g)), whitelists, sanctions/OFAC, transfer windows, tax-lot rules — driven by
  **ONCHAINID / W3C VC** identity.
- *Why:* the regulatory logic is the moat; make it declarative and every vertical inherits it.
- *Model:* ERC-3643 T-REX + ONCHAINID (already in the PRD).
- *Reuse:* `complianceService.checkTransfer` is the exact seam — add dimensions + a profile record on
  the asset.
- *Gate:* **A** (software); ⚖ counsel defines each profile.
- *Ramp:* **A**.

**P3 — Investment-management tools (the holder cockpit).**
- *What:* the "tools to manage your tokens" you asked for — portfolio dashboard, NAV/valuation,
  distributions history, **tax documents (1099-DIV / 1099-B / K-1)**, performance, statements,
  DRIP/rebalancing, corporate-action notices.
- *Why:* holders won't hold what they can't track/report; this is table stakes for real money and a
  retention/AUM lever.
- *Model:* Carta (cap-table/portfolio) + brokerage statements.
- *Reuse:* `corporateActionService` (distributions) + ledger projections + `pricingService` — the data
  exists; this is a reporting/UX layer.
- *Gate:* **A** (software); tax-doc generation ⚖ CPA.
- *Ramp:* **A**.

**P4 — Employee participation / equity compensation.**
- *What:* tokenized **equity / options / profits-interests as compensation**, with on-chain vesting,
  a live cap table, 83(b) tracking, and exercise — for Goemon's own team and as a product for other
  companies.
- *Why:* underserved and Goemon has a **head start** — the `docs/legal/EQUITY-INCENTIVE-PLAN.md`
  already models units/options/profits-interests + vesting + 83(b); the ledger + compliance enforce it.
- *Model:* Carta + on-chain vesting; ties to P5 (capital formation) and Phase 25 (SMB).
- *Reuse:* `equity` AssetKind + Compliance Module (transfer restrictions/lockups) + corporate actions
  (for distributions) + the Equity Incentive Plan legal spine.
- *Gate:* private-company securities (Rule 701 / Reg D), 409A valuation ⚖.
- *Ramp:* **A/B**.

**P5 — Capital formation / corporate financing (primary-raise rails).**
- *What:* a business raises capital by issuing tokenized **equity / debt / revenue-share** under
  **Reg CF / D 506(c) / A+** — accreditation checks, escrow-close, cap table, investor comms.
- *Why:* your "corporate/scalable financing" ask; the primary-market on-ramp for most of Part B.
- *Model:* Republic / StartEngine (Reg CF) + Securitize (Reg D).
- *Reuse:* escrow `subscribe → close/refund` **is** a compliant primary raise; add accreditation
  (P2) + funding-portal/BD partner.
- *Gate:* **B/C** — funding portal (CF) or BD (D/A+); ⚖.
- *Ramp:* **B → C**.

**P6 — Secondary liquidity — ATS + AMM (the liquidity unlock).**
- *What:* the trading venue that makes any tokenized asset *actually sellable* — a regulated **ATS**
  for securities, and bonding-curve/orderbook AMM for exempt assets (collectibles/commodities).
- *Why:* **illiquidity is the #1 reason RWA tokens die.** Solving it turns "fractional" into
  "fractional *and* liquid" — the "accessible investment" you asked for.
- *Model:* tZERO / Securitize Markets (ATS); AMM for exempt assets.
- *Reuse:* `marketplaceService.placeOrder` is the secondary engine — route it to a real venue/partner.
- *Gate:* **C** — broker-dealer + ATS registration (partner first).
- *Ramp:* **C** (cross-cutting; unlocks every vertical).

### Part B — Asset-class verticals (what to tokenize, beyond the current plan)

**V1 — Land (raw / undeveloped / entitled).** *(You asked: "what about land?")*
- *What:* raw parcels, land banking, entitled lots, development rights — distinct from Lofty's *built*
  housing. *Why:* huge, illiquid, underserved; simple title story vs operating property. *Model:*
  LLC-per-parcel + Reg D. *Reuse:* `security` profile + attestation metadata (deed/survey/title).
  *Gate:* Reg D/S, per-parcel LLC ⚖. *Ramp:* **B→C.**

**V2 — Farmland & agriculture.** *(You asked: "agriculture.")*
- *What:* farmland (AcreTrader model), crop/harvest **revenue-share**, livestock, **ag receivables,
  water rights**. *Why:* large, income-producing, inflation-hedge, underserved by crypto. *Model:*
  AcreTrader / FarmTogether. *Reuse:* security profile + corporate actions (harvest/rent
  distributions). *Gate:* Reg D + ag/land counsel ⚖. *Ramp:* **B→C.**

**V3 — Commodities & precious metals.** *(You asked: "commodities.")*
- *What:* gold/silver (1:1 vaulted), energy, **timber**, industrial metals. *Why:* proven demand;
  clean 1:1-backing story. *Model:* PAXG (gold) / vaulted-metal tokens. *Reuse:* `commodity` AssetKind
  + **proof-of-reserve / custody attestation** (`custodyAttestationUri`) + reconciliation. *Gate:*
  custodian + assayer; commodity/MSB posture ⚖. *Ramp:* **B.**

**V4 — Carbon & environmental / renewable-energy revenue.**
- *What:* carbon credits, solar/wind **project revenue-share**, RECs. *Why:* ESG demand + real yield;
  registry rails maturing. *Model:* Toucan / KlimaDAO (carbon) + project-revenue tokens. *Reuse:*
  security/commodity profile + oracle/registry integration + corporate actions (revenue). *Gate:*
  registry integration, double-count controls ⚖. *Ramp:* **B.**

**V5 — Small business — equity + revenue-based financing.** *(You asked: "small business.")*
- *What:* tokenize SMB ownership or **revenue-share** notes for Main-Street businesses; local/community
  investing. *Why:* enormous underserved capital gap; complements Phase 25 (SMB banking). *Model:*
  Honeycomb / Mainvest (Reg CF revenue-share). *Reuse:* escrow issuance (P5) + Compliance Module +
  corporate actions (revenue payouts). *Gate:* Reg CF portal / Reg D ⚖. *Ramp:* **B.**

**V6 — IP & royalties.**
- *What:* music, film, patents, publishing, brand-licensing — **recurring royalty streams**. *Why:*
  creator-economy demand; predictable cash flows map perfectly to pro-rata distribution. *Model:*
  Royal (music) / IP-royalty marketplaces. *Reuse:* security profile + `corporateActionService`
  (royalty distributions are just dividends by another name). *Gate:* Reg D/A+, IP/royalty admin ⚖.
  *Ramp:* **B→C.**

**V7 — Invoices / trade receivables / supply-chain finance.**
- *What:* tokenized **receivables** + working-capital pools. *Why:* B2B, high-velocity, real yield,
  proven on-chain. *Model:* Centrifuge (receivables/private credit). *Reuse:* security/debt profile +
  redemption (maturity payout) + corporate actions (coupons). *Gate:* Reg D, underwriting/servicer
  partner ⚖. *Ramp:* **B→C.**

**V8 — Luxury & alternative collectibles (MVP-adjacent extension).**
- *What:* art, watches, wine/whisky, rare cars, sneakers, memorabilia — fractional. *Why:* the
  **closest expansion to the collectibles MVP** — same HTS rail, tier-only gating, no securities
  overhead (until fractional-as-security). *Model:* Masterworks (art) / Rally. *Reuse:* the LIVE
  `collectible` path + escrow (`COLLECTIBLES_ESCROW_ENABLED`) + provenance metadata. *Gate:* A for
  whole-item; **fractional may be a security** ⚖. *Ramp:* **A → B (fractional).**

**V9 — Vehicles, equipment & machinery.**
- *What:* asset-backed **leasing** — fleets, aircraft/marine fractional, equipment finance; yield from
  lease income. *Why:* tangible collateral + recurring lease yield. *Model:* equipment-finance /
  fractional-jet platforms. *Reuse:* security profile + attestation + corporate actions (lease
  distributions). *Gate:* Reg D, servicer/lessor partner ⚖. *Ramp:* **B→C.**

**Frontier bin (noted, not in the 15):** fund-LP secondaries, sports/creator income-share, muni /
SME / consumer debt, insurance / parametric risk pools — revisit once the platform + first verticals prove out.

---

## 4. Prioritization & sequencing

Scored by **reuse-ease** (how much of the engine is already there), **market** (size/underserved),
**compliance gate** (A cheap → C expensive), and **MVP-adjacency**.

| Wave | Items | Rationale |
|---|---|---|
| **0 — MVP** | Collectibles (LIVE) | Ship as-is. No change. |
| **1 — Engine** | **P1** issuance console · **P2** compliance-as-a-service · **P3** mgmt tools | Highest leverage: turns every later vertical into "onboard a profile." Mostly Phase-A software on existing primitives. |
| **2 — MVP-adjacent** | **V8** luxury/alt collectibles | Same HTS rail, tier-only; fastest new revenue after the MVP. |
| **3 — Real assets** | **V1** land · **V2** farmland · **V3** commodities · **V4** carbon | Security profile + attestation/proof-of-reserve; issuer/custodian partners (B). |
| **4 — Capital formation** | **V5** SMB · **P5** corporate financing · **P4** employee equity | The primary-raise cluster; leverages escrow issuance + the Equity Incentive Plan. |
| **5 — Income streams** | **V6** royalties · **V7** receivables | Pure fit for the corporate-actions engine (recurring pro-rata). |
| **Cross-cutting** | **P6** secondary/ATS | Pursue in parallel once volume justifies the BD/ATS partner — it unlocks liquidity for **all** verticals. |

## 5. Compliance ramp (A→B→C) mapping

- **A — non-custodial software:** the platform layer (P1–P3), whole-item collectibles (V8), and every
  vertical's *software* (issuance/compliance/mgmt) with no customer-fund custody.
- **B — partnered:** issuer / custodian / transfer-agent / funding-portal + FinCEN MSB — unlocks the
  security verticals (V1–V7, V9), capital formation (P5), employee equity (P4).
- **C — licensed:** broker-dealer / **ATS** / transfer-agent registration — unlocks secondary
  liquidity (P6) and self-operated primary/secondary securities markets.

Consistent with `docs/business/CORPORATE-STRUCTURE.md`. The rule holds throughout: **distribute and
operate the rails; partner the regulated issuer/venue — don't become the issuer of record** until
scale justifies it.

## 6. Keep it simple first — the one engineering step that unlocks the rest

None of this displaces the collectibles MVP. When you're ready to build beyond it, the single
highest-leverage move is **not** a vertical — it's:

> **Generalize `AssetKind` into a data-driven asset-type registry + a compliance-profile registry, and
> build the P1 issuance console on top.**

After that step, each of V1–V9 is a **profile + metadata + (optional) issuer seam + a config flag** —
days, not projects — exactly the pattern already used for `equity`/`treasury`
(`*_ENABLED` + `*_PROVIDER` + prod-fatal). That is how "one-size-fits-all for the entire industry"
becomes real without building fifteen separate products.

---

*Roadmap home: Phase 29 (`docs/GOEMON-PLAN.md`) — Tokenization Platform, the umbrella over the
Phase-28 RWA menu. This document is the detailed design; the phase entry is the pointer.*
