# Goemon — Tokenization Market Review, Strategy & Go-Live Plan

**Audience:** founder / internal roadmap. Blunt, technical, action-oriented.
**Date:** 2026-07-05
**Status:** strategy doc — decisions flagged in §11. Not a commitment.
**Method:** external facts came from an 8-angle web-research fan-out with an adversarial verification pass (10 claims confirmed, 6 refined, 0 refuted). Repo facts came from a direct codebase audit. Every load-bearing number carries a confidence tag; projections are labeled as projections.

> **The one-paragraph read.** The non-stablecoin tokenization market is real but small (~$32.6B on-chain, mid-2026) and its two biggest pools — tokenized Treasuries (~$14.8B) and private credit (~$18.9B) — are owned by players you cannot out-issue (BlackRock/Securitize, Ondo, Circle, Franklin, Figure, Maple). The trillion-dollar 2030 forecasts are real but methodologically incoherent (an 8x spread that depends entirely on whether you count the money layer), so they are narrative, not a model input. Your defensible wedge is the one layer **no incumbent owns**: a non-custodial, DID/VC-gated, **MCP-mediated agent-permissioning** wallet that *distributes and reconciles other people's tokenized assets* into a real double-entry bank ledger, settled on USDC/Hedera. You have already built ~90% of that surface. What you have **not** built is the boring 10% that go-live actually requires: real KMS providers (the AWS/GCP ones are stubs that throw), a container/IaC/CI pipeline (none exists), production Hedera custody, a LICENSE, and the compliance/partner scaffolding. This doc updates the market thesis, rewrites the revenue and marketing strategy around the agent-native wedge, and lays out a concrete, sequenced path to production — plus two frontier partnership theses (DAO/Network-State treasury as a near-term wedge; space-economy banking as a horizon bet).

---

## 1. The market, verified

All figures as of mid-2026 unless noted. `[C]` = confirmed in verification pass, `[R]` = refined/corrected, `(proj)` = projection not actual.

### 1.1 Where the money actually is

| Category | On-chain value | Who owns it | Can you originate it? |
|---|---|---|---|
| **Stablecoins** | ~$295–321B `[C]` | Tether (~$186B/59%), Circle USDC (~$75–77B/24%) — ~83% combined | No. This is your **settlement rail**, not your product. |
| **Tokenized US Treasuries / MMF** | ~$14.8B (84 assets) `[R]` | Circle USYC ($3.1B), BlackRock BUIDL ($2.23B via Securitize), Ondo USDY ($2.2B), Franklin BENJI | No — distribute it. |
| **Tokenized private credit** | ~$18.9B active / ~$33.6B cumulative originations `[R]` | Figure (dominant, ~75% as on-chain record), Maple (~$2.1B), Centrifuge (>$1B) | No — distribute the yield. |
| **Tokenized equities** | growing; Backed xStocks >$25B cumulative volume `[C]` | Backed/Kraken (Solana), Dinari (US), Robinhood (~2,000 stocks, Arbitrum, EU-only) `[C]` | No — partner (Dinari-style) for the US-regulated path. |
| **Tokenized real estate** | fragmented ~$10–15B `[C]` | RealT (300+ homes, Gnosis), Lofty (150+, Algorand), Propy; Dubai gov deeds | **Maybe** — your Phase-29 real-estate vertical fits here, but it's a fragmented niche. |
| **Non-stablecoin RWA total** | **~$32.6B** `[C]`, +30% in Q1 2026, ~3–5x YoY | concentrated in <10 issuers | You are a **distributor + access layer**. |

**Growth is real but off a tiny base.** Non-stablecoin RWA went from ~$5.5–6B (Jan 2025) → ~$18.2B (Oct 2025) → ~$32.6B (Jul 2026). Fast, but ~1–2 orders of magnitude below even the low 2030 case.

### 1.2 The 2030 forecasts — narrative only, never a model input

| Source | 2030 figure | Method / caveat |
|---|---|---|
| McKinsey | **$2T base** (bear ~$1T / bull ~$4T) `[R]` | Bottom-up; **excludes** crypto, stablecoins, tokenized deposits, CBDCs (avoids double-counting the cash leg). Most conservative. |
| Citi | **$5.5T base** (bear $2.7T / bull $8.2T) `[R]` | Led by public equities + treasuries. (Note: the older "$4–5T" figure is Citi's 2023 number.) |
| BCG / ADDX | **~$16T** (proj) | Top-down: assumes ~10% of global GDP tokenized. Aggressive. |
| Standard Chartered | **~$30.1T by 2034** (proj) | Per-asset-class buildup (e.g. 14% trade finance). |

The 8x McKinsey↔BCG gap is **definitional, not directional** — everyone agrees it grows; they disagree on what counts. **Use these on a TAM slide; never in unit economics.**

### 1.3 What this means for Goemon

You correctly chose (Phases 28–29) **distribute-and-reconcile, not issue**. The data validates that hard: you cannot out-originate BlackRock, Circle, or Figure, and you should never try. Your product is the **agent-native access + compliance + settlement layer** on top of their assets, plus riding the ~$300B stablecoin base as the settlement primitive (which is exactly why USDC-on-Hedera is the right call).

---

## 2. Competitive landscape & where you wedge in

The market has **stratified** into three layers. Map yourself deliberately.

**Layer 1 — Issuers / infrastructure (do not compete):**
- **Securitize** — dominant platform + SEC transfer agent; powers BlackRock BUIDL (~$2.5B), $4B+ AUM. `[C]`
- **Tokeny** — *authored ERC-3643, the standard you already use*; acquired by Apex Group ($32B+ tokenized, targeting $100B by 2027). `[C]`
- **Ondo** — verticalizing into a full-stack platform with its own L1 (Ondo Chain) + a 100+ stock "Global Markets" rail.
- **Midas** — permissionless ERC-20 T-bills (mTBILL/mBASIS), $1.7B cumulative, $50M raise (Franklin, Coinbase Ventures, Framework). `[C]`
- **Franklin Templeton BENJI** — first US-registered tokenized MMF, 8 chains incl. Stellar, ~$2B suite. `[C]`

**Layer 2 — Distribution (partner, don't fight):**
- **Backed / xStocks** — largest tokenized-equity framework by volume (>$25B cumulative), on Solana via Kraken/Bybit; **Kraken is acquiring Backed**. `[C]`
- **Dinari** — the US-regulated path: SEC-registered **transfer agent** *and* (June 2025) the first US **broker-dealer** registration for a tokenized-equity platform; dShares are 1:1-backed tokenized US stocks. `[R]` **This is your most likely equities partner** (your Phase-18.6 seam already has a `dinari` stub).
- **Robinhood** — ~2,000 tokenized stocks on Arbitrum, EU-only, building "Robinhood Chain," lobbying the SEC for a US rulebook. `[C]` Co-authored **ERC-8056** (on-chain corporate actions) with Superstate — *track this; it's where your dividend/corporate-action seam should converge.* `[R]`

**Layer 3 — Chains (you've picked Hedera):**
- Ethereum leads (~$12–16B, ~49% of RWA) on **DeFi composability + liquidity** — the real reason issuers pick it. `[C]`
- Provenance ~27% (via Figure), Solana ~$3.3B, BNB ~$4B, Stellar ~$1.5B.
- **Canton Network** is the rising institutional-privacy threat (Goldman/BNP/DRW, $135M raise; DTCC tokenizing Treasuries) — same regulated turf as Hedera. `[C]`
- **Hedera is a small-but-credible institutional niche**, validated by **Archax** (FCA-regulated, $300M+ from six managers incl. abrdn, real-time USDC yield). It is not a liquidity hub.

### The uncontested wedge

The one frontier no incumbent RWA issuer owns is **agent-native payments + permissioning**. By April 2026, x402 (Coinbase's HTTP-402 stablecoin standard) + Google's AP2 processed **~165M agent transactions across ~69,000 active agents**. `[C]` **No RWA issuer owns the consumer/agent wallet layer.** That is your lane:

> **Goemon = the non-custodial, DID/VC-gated, MCP-mediated bank ledger that lets AI agents transact on tokenized real-world assets under scoped, user-granted permission — settled in USDC on Hedera.**

Nobody combines: (1) tokenized RWA access, (2) self-custody wallet, (3) native permissioned agent access. Chime/Revolut/Mercury have (nothing crypto), Coinbase/Robinhood have (1)+partial(2) but no agent-permissioning, the RWA issuers have (1) only. **Own the intersection.**

---

## 3. What you've built vs. what the market needs

Your codebase is *far* ahead of a typical pre-launch fintech. The gap analysis:

| Market need | What you've built | Gap to production |
|---|---|---|
| Distribute third-party RWA | Phase-8 marketplace, Phase-28/29 registry-driven engine (issuance, compliance profiles, portfolio, secondary market), verticals (real estate, commodities, IP royalties) | Real issuer partners not wired (Dinari/Ondo/Franklin stubs exist) |
| Compliant securities | ERC-3643 model in-app, compliance-as-a-service dimensions | No deployed/audited on-chain ERC-3643; Hedera Asset Tokenization Studio not integrated |
| Settlement rail | USDC-on-Hedera path, build/submit non-custodial signing, Temporal money workflow | Testnet-default; mainnet creds + wrapped operator key needed |
| Self-custody | Secure-Enclave iOS wallet, Android scaffold, `did:key` binding, OID4VP | iOS unverified (no Xcode build); on-device signer throws `NOT_IMPLEMENTED` |
| Agent access | Phase-7 MCP server, OID4VP VP-verification, scoped 90s tokens, per-agent rate limit | Not open-sourced (see §7); x402 rail is Phase-21 prototype behind kill-switch |
| Bank ledger | Double-entry ledger, append-only, idempotent, reconciliation vs chain, FBO coverage | Correct — this is your Synapse-proof moat (see §8.6) |
| Custody invariant (m) | keyVault wraps keys at rest; signer seam (keyvault/hsm/ondevice) | **AWS/GCP KMS providers are STUBS that throw; HSM backend throws** |
| Fraud/risk | Standalone fraud-engine (27 tests), hybrid triage, remediation freeze | Real Kafka/Flink/Triton are the production swap |

**Verdict:** the *product* is largely built. The *productionization* — custody hardening, deploy pipeline, partner integrations, compliance scaffolding — is the actual remaining work. That is good news: it's mostly boring, sequenceable engineering + BD, not new invention.

---

## 4. Revised revenue strategy

The modelable stack has **four tiers, ordered by margin × defensibility.** Lead with the top two for margin/scale; use tokenization fees as the differentiated wedge; treat the rest as ARPU expanders.

### Tier 1 — Float / reserve spread (the crown jewel)
Whoever holds the reserves keeps the **full 4–5% T-bill yield** — and the **GENIUS Act (July 2025) legally protects it**. `[C]` Tether/Circle prove this is the highest-margin line in the entire industry. **Capture spread on idle customer USDC / settlement balances.** This should anchor the model even if headline product fees are thin. Your Treasury (`ATB`) and lending pool primitives already touch this.

### Tier 2 — Interchange (the scalable workhorse)
Debit interchange runs **150–200 bps per swipe** through a **Durbin-exempt sponsor bank** (<$10B assets) `[C]` — vs. the capped $0.21+5bps for large issuers. This is what makes **Chime an 88%-gross-margin, ~$251-ARPU business with 67–76% of revenue from interchange.** `[C]` Your Phase-19.4 `cardService` already models the auth→capture lifecycle as ledger holds. **Build the debit/card program early** — it's license-light (via sponsor bank) and it scales.

### Tier 3 — Tokenization take-rates (the differentiated wedge)
Real but modest and volume-dependent. Benchmark to copy:
- **Tokenized-treasury management:** 15–50 bps, net 4–5.25% APY (SOFR minus fee). `[C]`
- **Equities (Dinari model):** flat per-order fee + 25–50 bps order fee + **5% cut of dividends**. `[C]`
- **Private credit (Maple model):** flat 50 bps on AUM (70–90 bps all-in). `[C]`
- **B2B tokenization-as-a-service (Securitize model):** $50–100k min engagement (setup + issuance + transfer-agent) + annual compliance + ATS commissions. `[C]` **Your Phase-29 issuance console is exactly this product** — sell it to other would-be issuers.

### Tier 4 — ARPU expanders
- **Collateralized lending** (your Phase-19 `lendingService`): borrow-minus-deposit spread, ~80% LTV, ~83% liquidation threshold, ~5% penalty (Aave benchmark). `[C]`
- **On/off-ramp rev-share:** ramps charge ~1% (ACH) to 4.5% (card), 7–8% all-in with spread — take a slice. `[C]`
- **FX:** 0.5–1% markup above a free allowance. `[C]`
- **Subscriptions:** $4–70/mo, 3–4 tiers. `[C]`
- **Agentic (x402) rail:** **zero protocol fee today** `[C]` — do **not** model a per-call take-rate. Monetize via settlement **float**, priced premium agent actions, and subscription tiers.

**Modeled revenue thesis:** *float + interchange for margin and scale → tokenization fees as the wedge → lending/ramp/FX/subscription as ARPU lift.* Do not build the model on tokenization take-rates alone; they're too thin and too volume-dependent at your stage.

---

## 5. Revised marketing / GTM strategy

**Do not launch as a broad consumer neobank.** 76% of neobanks are unprofitable and sector CAC is brutal — that is a fight you lose on brand and budget. Instead, a **niche-first, developer-led, narrative-riding** motion.

### 5.1 Positioning
Claim the **uncontested intersection**, never a head-to-head:
> *"The bank your AI agent can actually use — tokenized real-world assets, self-custodied, with permissioned agent access."*

Avoid comparing to Chime/Revolut/Coinbase/Robinhood. You are not a cheaper Chime; you are the only agent-native tokenized-asset bank.

### 5.2 Distribution — lead with the developer/agent channel
In agentic commerce **the buyer is increasingly the agent (and its developer)**, reachable via open protocols, not consumer ads. This is the one channel where small + fast beats incumbent brand:
- Ship an **open MCP server** + **x402-compatible endpoints** so external agents (Coinbase AgentKit, Stripe agent toolkit, Bedrock/Anthropic tool use) can transact against Goemon out of the box.
- PLG/API distribution + referral/organic loops — **not** paid performance marketing.

### 5.3 Ride the two attention waves already in motion
1. **RWA tokenization** — the dominant crypto narrative of 2025–26. You ride it, you don't create it.
2. **Agentic payments** — real, crowded, with credible $300B–$1T-by-2030 sizing and shipped incumbents (Stripe agent toolkit, Coinbase AgentKit, x402, Skyfire, Google AP2, Visa/Mastercard agentic commerce). Your "why now."

Co-market **inside the Hedera ecosystem** (Hedera positions itself as an agentic-payments + regulated-tokenization settlement layer) rather than fighting for attention alone.

Tactics: founder thought-leadership on X + original vertical data (own a data narrative), **side-events** at Token2049 / Consensus / RWA Summit (not sponsorship spend), developer content.

### 5.4 Marketing must be a compliance-gated funnel (this is non-negotiable)
Advertising rules differ sharply by exemption — you need a **segmented content architecture, not one funnel**:
- **Reg D 506(c):** the **March 2025 SEC no-action relief** materially widened the lane to *publicly* market accredited-only tokenized deals behind high-minimum verification. Exploit it — but verify accreditation.
- **Reg A / Reg CF:** route retail top-of-funnel content here, with proper disclaimers and portal-only terms.
- **Never** mix general-solicitation content with 506(b) private deals — that blows the exemption.

### 5.5 Pick ONE vertical and win it end-to-end
Before broadening, dominate one under-served RWA vertical. Candidates from your existing build: **real estate**, **IP/royalties**, or **agent-operated treasury yield**. Recommendation: **agent-operated treasury yield** — it's the tightest fit to your agent-native wedge and the least crowded (nobody sells "let your agent manage your stablecoin yield across tokenized T-bills under scoped permission").

---

## 6. Open-source strategy

**Thin open surface, closed operational core.** The winning pattern in tokenization infra is *"open the standard/SDK/reference contracts, monetize the platform and services"* — the code is a loss leader for adoption; the moat is **data, rules, licenses, operations, and partner relationships.** `[C]` (OpenZeppelin is the canonical open-core template; Hedera's own tools ship Apache-2.0.)

### Open-source (Apache-2.0 — matches the Hedera ecosystem)
- **The MCP server + agent tool schemas.** Open MCP is now **table stakes** for developer adoption. `[C]` This is your distribution engine — the whole GTM in §5.2 depends on it being open and forkable.
- **A wallet / VC SDK** (`did:key`, OID4VP, VP-signing) — credibility + adoption.
- **Reference issuance / compliance-rule contracts** (ERC-3643 wrappers) — trust + ecosystem.

### Keep closed
- **The double-entry ledger operations + reconciliation logic** — your Synapse-proof moat.
- **The fraud/risk engine's rules + training data.**
- **KYC/AML + jurisdiction mappings.**
- **Orchestration / business logic / hosted platform tooling.**

Do **not** rely on security-by-obscurity (audited-in-the-open is the crypto norm; hiding ledger math buys little). But **do** defend anything you host: license self-hostable-but-competitively-sensitive components under **AGPL or BSL**, not permissive — the Redis→Valkey and Elastic→OpenSearch forks prove permissive licensing of a crown-jewel *service* is a real risk. Watch the counter-trend: Stripe (Tempo) and Circle (Arc) are walling off the app layer with proprietary chains.

### Immediate action
**Add a LICENSE file — there is none today**, which means the repo is all-rights-reserved by default and nobody can legally use even the parts you *want* adopted. Split the repo: `goemon-mcp` + `goemon-wallet-sdk` public (Apache-2.0); `backend/` core stays private (or AGPL if you ever want it self-hostable-but-defended).

---

## 7. Path to go-live

Ordered by dependency. The four **hard blockers** first (they're small but non-negotiable), then infra, then Hedera, then compliance.

### 7.0 The four hard technical gaps (fix these first)
From the codebase audit — these will stop a production boot or leave you legally/operationally exposed:

1. **The AWS/GCP KMS providers are stubs that throw.** `config.ts` is prod-fatal on `KMS_PROVIDER=local`, so production *requires* `aws|gcp` — but `awsKmsProvider()` / `gcpKmsProvider()` both call `notImplemented()`. Config passes; the first key wrap/unwrap throws. **You must implement at least one real KMS provider before production boot means anything.**
2. **The HSM and on-device Hedera signers throw `NOT_IMPLEMENTED`.** `HEDERA_SIGNER=keyvault` works; `hsm` and `ondevice` don't. Fine for launch (use `keyvault` with a real KMS), but the non-custodial `ondevice` story your brand promises isn't wired server-side end-to-end yet.
3. **No Dockerfile, no IaC, no CI/CD.** Nothing containerizes or deploys the app. This is the single biggest infra gap. (See §7.1.)
4. **No LICENSE file.** (See §6.)

### 7.1 Cloud infrastructure setup (AWS reference — AWS edges GCP on fintech compliance breadth)

Reference architecture (maps 1:1 to GCP if you prefer):

```
Internet → CloudFront (CDN) → WAF → ALB
                                      │
                              ECS Fargate (backend, Node/TS)   ← Secrets Manager (env, no plaintext keys)
                                      │
                              RDS Postgres (Multi-AZ)          ← the ledger
                                      │
                              AWS KMS (asymmetric signing)     ← wraps issuer JWK + per-user Hedera keys
                                      │
                              Self-hosted Hedera Mirror Node   ← reconciliation (public node throttled ~50 req/s)
```

**Concrete steps:**
1. **Write a Dockerfile** for `backend/` (multi-stage: build TS → `dist/`, copy migrations, run as non-root). Do the same for `frontend/` (static build → CloudFront/S3) and `goemon-agent/`.
2. **Write IaC** (Terraform or AWS CDK) for: VPC (private subnets), RDS Postgres Multi-AZ, ECS Fargate service, Secrets Manager, KMS keys, WAF, CloudFront. Keep it in `infra/`.
3. **CI/CD** (GitHub Actions — there's no `.github/` today): on PR → `npm run typecheck && npm test && npm run build`; on merge to `main` → build image, push to ECR, deploy to Fargate. Wire `scripts/launch-gate.sh` as the CI gate (it already does typecheck + tests + iOS verify + e2e hint).
4. **DB:** set `DATABASE_URL` → app auto-selects Postgres (`config.ts:545`). Run `npm run migrate` (53 migrations) as a pre-deploy step.
5. **Secrets:** all 127 env vars flow through `config.ts`. Populate from Secrets Manager. **Never** put `HEDERA_OPERATOR_KEY` or `JWT_SECRET` in plaintext env — wrap the operator key (§7.2) and pull secrets at boot.

**Cost reality:**
- Low-volume dev posture: **$100–500/mo** (compute + managed Postgres + CDN).
- Production regulated posture (Multi-AZ RDS, WAF, KMS, logging): **low four figures/mo** before observability. `[C]`
- **AWS KMS:** ~$1/key/mo + $0.15 per 10k asymmetric signs — **effectively free at low volume.** `[C]` Use KMS, not CloudHSM (~$1,168/mo per HSM, ~$2,336/mo redundant), until custody scale demands it.
- **Avoid the Datadog cost cliff** (bills run 2–3x estimates once APM+logs+containers compound). You already have prom-client + pino; self-host Grafana/Loki until volume justifies Datadog.
- **Keep Temporal/Conductor self-hosted** (they degrade to in-process). Temporal Cloud has no free prod tier ($6k startup credits, then ~$100/mo + ~$50/M actions).

### 7.2 Production Hedera keys setup (concrete)

The Hedera SDK path is **real** (testnet by default). To go live on mainnet:

1. **Create a mainnet account.** ~$0.05 to create. `[C]` Fund the operator with HBAR for fees.
2. **Choose key types deliberately:**
   - **ED25519** for the operator doing cheap native ops (HTS transfers, associations) — cheaper, rekeyable, native.
   - **ECDSA secp256k1** *where you need it* — EVM/JSON-RPC (ERC-3643 via Asset Tokenization Studio) **and KMS signing (AWS/GCP KMS only sign secp256k1, not ED25519).** `[C]` This is a real constraint: if you want KMS to hold the key, it must be ECDSA.
3. **Wrap the operator key.** `config.ts:397` is prod-fatal on a raw operator key — it must be `gcm.v1.`-prefixed. Run `npm run wrap-secret` to produce the blob; `resolveOperatorKey()` unwraps it at boot (AAD `hedera:operator`). **With a real KMS provider (§7.0.1), the master key lives in KMS, not on the box.**
4. **Close custody invariant (m) for real** with a **native Hedera m-of-n threshold KeyList** across Fireblocks (MPC) and/or KMS — Hedera does multi-sig at the protocol level, no smart contract needed. `[C]` For issuer/treasury keys this is the difference between "wrapped at rest" and "no single point of compromise."
5. **Set:** `HEDERA_ENABLED=true`, `HEDERA_NETWORK=mainnet`, `HEDERA_OPERATOR_ID`, wrapped `HEDERA_OPERATOR_KEY`, real `HEDERA_USDC_TOKEN_ID` (native Circle USDC-HTS: <3s finality, ~$0.001/transfer). `[C]`
6. **Self-host a Mirror Node.** The public REST API is throttled to ~50 req/s per IP `[C]` — your Phase-20 reconciliation loop will hit that. Run the open-source Mirror Node behind it.
7. **Token standard split:** ERC-3643 (HSCS/EVM) for compliance-gated securities; HTS native for stablecoin + collectible ops. Your Phase-8 model maps onto both.

**Honest caveat:** Hedera's tech is production-ready and enterprise-credible (Archax/abrdn prove it), but **external DeFi liquidity for Hedera RWA is thin** — you provide the on/off-ramp depth and liquidity yourself. Don't expect Ethereum-style composable liquidity.

### 7.3 Custody / KMS (implement, don't stub)
- Implement `awsKmsProvider()` (or `gcpKmsProvider()`) in `keyVaultService.ts` against real KMS asymmetric signing. This is the load-bearing fix — it closes invariant (m) *for real* and unblocks production boot.
- Keep the `keyvault` signer as default; wire the `hsm` backend later only when custody scale demands CloudHSM/PKCS#11.
- Principle: **the private key never exists in plaintext in process memory** — KMS/HSM signs inside hardware. `[C]` Your seam already encodes this; the providers just need bodies.

### 7.4 Compliance & licensing — the passthrough model (Phase A)
The dominant cost/time sink is regulatory, not technical. **Do not get your own MTLs** — full US footprint is **$250–475k+ and 3–24 months per state.** `[C]` Instead, the **passthrough model** (your stated Phase-A posture, and it's correct):
- **BaaS sponsor bank** holds the money under its charter. **Prefer vertically-integrated sponsors that own their charter + expose their own API (Column, Lead Bank) over middleware aggregators (Unit, Treasury Prime — and never Synapse-style).** `[C]`
- **Licensed on/off-ramp provider** (MoonPay/Stripe/Coinbase) holds the MSB/MTL under *its* license and runs KYC; **Goemon only credits delivered value** — exactly what your `onRampService`/`offRampService` Phase-A posture already implements.
- **FinCEN MSB registration** is a free federal filing (Form 107, $300 renewal/2yr) — do it, but know it's **not a license.** `[C]`

**Budget year-one compliance:** SOC 2 Type II + PCI + KYC/AML ≈ **$180–380k.** `[C]` Levers to cut it:
- **SOC 2 Type II:** ~$30–50k (Vanta/Drata/Secureframe + auditor) + 3–12 mo observation window + 8–12 wk readiness. `[C]` Start the clock **now** — the observation window is the long pole.
- **PCI: stay at SAQ A (~$8–20k) by never touching raw PAN** — use hosted payment pages / issuer-processor tokens. A custom card form that passes PAN triggers SAQ D (~$40–80k) or a Level 1 QSA audit at 300k+ tx/yr. `[C]` Your masked-PAN-only card model already keeps you here — **don't regress it.**

### 7.5 The Synapse lesson (you already pass it)
The **Synapse collapse (April 2024)** — 100k+ users lost access to $265M+, an $85–95M shortfall — happened because **internal FBO ledgers could not be reconciled against pooled bank-held funds.** `[C]` This is *the* go-live requirement for a BaaS neobank. **You already implement the fix**: append-only double-entry ledger, `fboCoverage` (never-commingle 1:1), and `reconciliationService` (ledger⇄chain). This is a genuine competitive and regulatory advantage — **make it a marketing point** ("provably reconciled, Synapse can't happen here"), and keep it independently verifiable.

### 7.6 Sequenced launch checklist

**Phase 0 — Unblock (weeks 1–4):** — *cloud decided: **GCP**. Runbook: `docs/PHASE-0-GO-LIVE-RUNBOOK.md`.*
- [x] Add LICENSE (proprietary at root now; Apache-2.0 SDKs split out in Phase 3).
- [x] Implement one real KMS provider — **GCP Cloud KMS** (`gcpKmsProvider`, AAD-bound, tested).
- [x] Write Dockerfile + Terraform (`infra/`, GCP) + GitHub Actions CI (`ci.yml`/`deploy.yml`).
- [x] Prove the image boots on Postgres locally + **fixed the migration Postgres-incompatibility** (027–031 `datetime()`), so all 53 migrations apply.
- [ ] Apply Terraform to a real GCP project; run the migrate job against Cloud SQL (needs your GCP account — see runbook).

**Phase 1 — Hedera mainnet + custody (weeks 3–8):**
- [ ] Create mainnet operator (ECDSA for KMS), wrap the key, close invariant (m) with a threshold KeyList.
- [ ] Self-host Mirror Node; point reconciliation at it.
- [ ] End-to-end money test on mainnet with tiny amounts.

**Phase 2 — Compliance + partners (parallel, weeks 1–24, the long pole):**
- [ ] File FinCEN MSB (free, immediate).
- [ ] Start SOC 2 Type II observation window **now**.
- [ ] Sign a BaaS sponsor bank (Column/Lead Bank) + a licensed on/off-ramp provider.
- [ ] Sign a US equities partner (Dinari) if equities are in the launch vertical.
- [ ] Confirm PCI SAQ A scope (no raw PAN).

**Phase 3 — Open the wedge (weeks 6–12):**
- [ ] Split out + open-source `goemon-mcp` and `goemon-wallet-sdk`.
- [ ] Ship x402-compatible endpoints.
- [ ] Publish developer docs; begin founder thought-leadership.

**Phase 4 — Niche launch:**
- [ ] Launch ONE vertical (recommend agent-operated treasury yield) to a design-partner cohort.
- [ ] Turn on interchange (card program) via sponsor bank for margin.

---

## 8. Frontier partnership theses

Both are better read as **long-dated brand/positioning bets than 2026 revenue lines** — but each contains one concrete, buildable-now wedge. Grounded tier first, visionary tier second, clearly separated.

### 8.1 GROUNDED (near-term, buildable on your current stack)

**8.1.1 — DAO / Network-State treasuries (this is the real near-term wedge).**
The durable customer is *not* the unbuilt charter city — it's the **~$30–32B of DAO treasuries** (early 2025) that are **dangerously undiversified: ~67% native governance token, only ~18% stablecoins.** `[C]` They visibly need stablecoin cash management, tokenized-Treasury yield, and multisig-friendly banking — and the **July 2025 GENIUS Act just de-risked the settlement layer.** `[C]` This maps *directly* onto what you've built:
- Your **stablecoin settlement + tokenized-treasury distribution** = the diversification product they need.
- Your **Hedera threshold KeyList + scoped agent access** = the multisig/agent-operated treasury governance they need.
- **Action:** package a "DAO Treasury" account tier — stablecoin custody + agent-managed tokenized-T-bill yield + multisig approvals. Low competition, high strategic signal.

**8.1.2 — Próspera & pop-up cities as lighthouse design partners.**
**Próspera (Roatán, Honduras)** is the only real operating charter-city customer base (~2,000 residents/e-residents) — crypto-native, Bitcoin legal tender, a "Bitcoin District," e-residency company formation, a 1% biz / 5% wage / 2.5% sales-tax regime. `[C]` It maps onto your stablecoin-settled citizen/e-resident accounts + tokenized membership/land primitives. **Caveat (real):** its legal foundation was ruled unconstitutional and it's in **ICSID arbitration against Honduras** — so treat it as a *design partner and credibility signal*, not a revenue base. Pop-up cities (Zuzalu/Edge City/Vitalia) are **ephemeral** (weeks-long) — good for pilots and narrative, not recurring customers. Praxis raised $525M (Oct 2024) but pivoted to "Atlas" (a CA defense/spaceport city) and is **unbuilt** — watch, don't bet.

> **Grounded verdict:** pursue the **DAO/network-state treasury wedge as a near-term product**; court **Próspera + pop-up cities as lighthouse design partners** for signal, not P&L.

### 8.2 VISIONARY HORIZON (structured moonshot — thesis + what would have to be true)

Frame each as: *what's real today → what's speculative → what would have to be true for Goemon to matter.*

**8.2.1 — The space economy as a financing/banking frontier.**
- **Size:** forecast to triple to **$1.8T by 2035** (from ~$630B in 2023/24, WEF/McKinsey) — **but overwhelmingly terrestrial "space-enabled" revenue**, not off-planet activity. `[C]`
- **Real and operating today:**
  - **In-space manufacturing** — Varda Space has flown and returned **three** orbital drug-processing capsules, raised $329M. `[C]` This is the one off-planet activity with a real business.
  - **Connectivity backbone** — **Starlink Direct-to-Cell (T-Mobile "T-Satellite") went commercially live July 23, 2025.** `[C]` The real rail any "off-grid"/M2M payment concept would ride.
  - **Commercial LEO stations** — transitioning paper→hardware 2026–2028, backed by a NASA $1.5B Phase-2 program. A real capex-financing + asset-tokenization surface. `[C]`
  - **Space insurance** — the one mature space financial service, a ~$4B market — **but stressed** (2023–24 loss ratios >100%). `[C]`
- **Decades out (do not bet the model):**
  - **Asteroid mining** — pre-revenue, unproven; AstroForge's Odin probe **failed March 2025**, demo slips to a 2026 launch. `[C]`
  - **Off-planet living (lunar base)** — 2030s+ government-led; NASA "initial operating capability" 2029–2032, semi-permanent crew only from 2032+. `[C]`
  - **M2M / satellite blockchain settlement ("space DePIN")** — proof-of-concept only; Spacecoin routed the first blockchain tx through LEO in late 2025; SEALCOIN similar. The most speculative part. `[C]`
- **What would have to be true for Goemon to matter:** a critical mass of *Earth-based* space companies (manufacturers, LEO-station operators, launch providers) needing **agent-native, stablecoin-settled B2B treasury / AR-AP / cross-latency settlement** — and no incumbent "space bank" exists (they're served today by VC, specialist insurers, NASA/DoD contracts, and generic corporate banking). `[C]`

> **Space verdict:** the **only defensible near-term space revenue is conventional stablecoin B2B settlement/AR-AP for Earth-based space manufacturers** (Varda-type customers). Treat everything orbital (tokenized space-infra assets, latency-tolerant M2M/satellite settlement, "off-planet banking") as a **credibility-building R&D narrative and brand bet — not a P&L line.** The "agent-native machine payments across a Starlink backbone" story is a *positioning asset* today, buildable as a real product only as LEO stations and in-space manufacturing scale (2028+).

**8.2.2 — The synthesis bet.** The two frontier theses converge on one idea: **sovereign, agent-operated economies (whether a network state, a DAO, or an orbital manufacturer) need programmable, stablecoin-settled, agent-permissioned banking that legacy banks won't provide.** That is the *same* product as your core wedge — just pointed at customers who don't exist at scale yet. So the frontier work is **free optionality**: build the agent-native tokenized bank for DAO treasuries *now*, and the same rails serve network states and space companies as those markets mature. No separate build required.

---

## 9. Decisions you need to make now

These are yours; the codebase and market don't decide them:

1. **Launch vertical** — recommend **agent-operated treasury yield** (tightest fit to the agent-native wedge, least crowded). Alternatives: real estate, IP/royalties. → §5.5
2. **Cloud** — ✅ **DECIDED: GCP** (2026-07-05). Cloud Run · Cloud SQL · Cloud KMS · Secret Manager; IaC in `infra/`. → §7.1 / runbook
3. **KMS provider** — ✅ **DECIDED + BUILT: GCP Cloud KMS** (`gcpKmsProvider`, tested). CloudHSM/Fireblocks remain a later scale option. → §7.3
4. **Open-source scope** — ✅ **DECIDED: proprietary now** (root LICENSE added); `goemon-mcp` + `goemon-wallet-sdk` split out Apache-2.0 in Phase 3. → §6
5. **BaaS sponsor + ramp partner** — recommend a charter-owning sponsor (Column/Lead Bank) + a licensed ramp (MoonPay/Stripe/Coinbase). → §7.4
6. **Equities partner** — Dinari (US-regulated, your stub already exists) if equities are in the launch vertical. → §2
7. **Frontier posture** — treat DAO/network-state treasury as a **real near-term product**; treat space as **narrative/R&D**, not roadmap. Confirm you agree. → §8

---

## 10. Sources & confidence

- Market figures: rwa.xyz, DefiLlama, Security Token Market, InvestaX Q1-2026 report, The Defiant, Yellow.com research. Verified against multiple trackers; disagreement is dated-snapshot + methodology (noted inline).
- Forecasts: McKinsey, BCG/ADDX, Citi, Standard Chartered — **projections, labeled as such.**
- Hedera specifics: Hedera docs, Asset Tokenization Studio, Archax/abrdn reporting, Mirror Node docs.
- Cloud/custody/compliance: AWS/GCP pricing pages, Vanta/Drata, FinCEN, Synapse post-mortem coverage.
- Frontier: Praxis/Próspera reporting, DAO treasury trackers, WEF/McKinsey space-economy report, Varda/AstroForge/NASA/Starlink announcements.
- Full research artifact (all findings + sources + verification verdicts) is in the session transcript; regenerate via the `deep-research` workflow if figures need refreshing (they move monthly).

**Confidence summary:** market-size, competitor, revenue-benchmark, and Hedera-cost claims are **high confidence** (verified). Compliance cost ranges are **medium** (vendor-dependent). 2030 forecasts are **directional narrative only.** Frontier space/network-state maturity verdicts are **high confidence on what's real today, speculative on timelines** (by nature).
