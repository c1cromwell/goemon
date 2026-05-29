# 00 — Executive Summary

## What we're building

Bankai is a mobile-first neobank that wedges into the market through tokenized real-world assets and collectibles, with a dollar wallet underneath that works in 30 seconds with no paperwork. The user-facing product is one app that lets a person hold USDC, browse and buy tokenized US Treasuries, real estate fractions, private credit, Pokémon cards, and Web3-native game items, send money to friends across borders, and (over time) borrow against their holdings and spend with a debit card.

The back office is run by AI agents operating on top of Conductor OSS workflows, with humans in the loop for high-stakes decisions and regulatory review.

## Why now

Three things converged in 2024-2025 that made this feasible: the GENIUS Act gave stablecoin issuance federal protections and a regulatory floor; ERC-3643 and adjacent compliance standards matured to the point that institutional issuers (BlackRock, Franklin Templeton, Brevan Howard) have live products; and Hedera became a credible institutional settlement venue with $27B+ in tokenized assets, sub-3-second finality, USD-pegged fees, and protocol-level account abstraction that makes passkey-bound wallets feasible without smart-contract overhead.

Embedded wallet infrastructure (MetaMask Embedded Wallets, Privy, Openfort) and identity infrastructure (Verifiable Credentials, mDLs, Apple Wallet ID) have similarly matured to the point that you can ship a self-custodial, passkey-native, KYC-on-demand consumer app without building any of that stack from scratch.

## Who we compete with

| Competitor | What they own | Where we win |
|---|---|---|
| Robinhood | Equities + crypto retail | Tokenized RWAs (private credit, real estate, collectibles) and global reach |
| Revolut | Multi-currency wallets, EU rails | US + EM coverage, on-chain composability, RWA marketplace |
| Chase / traditional banks | Trust, branches, lending | Self-custody, programmability, instant cross-border, fee structure |
| Arca, Kast, Plasma One | No-KYC USD wallets | Adds marketplace, lending, regulated tier when needed |
| Securitize Markets, tZERO | Institutional RWA trading | Consumer UX, mobile-first, broader asset surface |

Our defensible position is the combination of (a) consumer-grade tokenization marketplace, (b) USD wallet that works without KYC at Tier 0, (c) global coverage from day one, and (d) agent-operated cost structure that lets us undercut traditional neobanks on per-user operating cost.

## What we ship at launch (v1)

The customer-facing v1 includes:

1. iOS, Android, and web clients with passkey-first authentication
2. Self-custodial Hedera-based USDC wallet, gas-sponsored so users never see HBAR
3. Three-tier identity ladder; Tier 0 requires only email or passkey signup
4. Marketplace listing ~15 third-party tokenized assets (5 treasuries, 5 real-estate/private-credit, 5 collectibles/gaming)
5. Peer-to-peer USDC transfer with Travel Rule compliance over $3K
6. Fiat on/off ramp in US (via partner bank) and 3 international corridors (priority: Nigeria, Philippines, Brazil)
7. In-app activity feed, basic portfolio view, push notifications
8. Customer support powered by AI agent with human escalation
9. Internal admin console (the repurposed Bankai CLI) for compliance reviewers and ops

What we explicitly do NOT ship in v1:
- First-party tokenization (v2)
- Lending products of any kind (v2/v3)
- Debit card (v2)
- Direct ACH or wire send/receive in customer's name (v2)
- Tax reporting beyond basic transaction export (v2)
- Investment advice or robo-advisor features (potentially never)

## How we operate

A team of roughly 30-45 people supported by AI agents handling first-line operations across customer support, compliance review, fraud monitoring, marketing, and engineering on-call. Agent skills are versioned MCP servers with scoped permissions; humans approve anything that moves real money over a threshold, sends to a large audience, or carries material legal/reputational risk.

## Capital and timing

This PRD assumes a serious capital base (estimated $25-40M through public launch) and a 12-18 month build from green-field to v1 public launch in two regions. A leaner v1 (US-only or international-only) is possible at roughly half the capital and time, with the geographic decision documented in Module 10.

## Reading order for new readers

1. This document (you are here)
2. [Vision & Positioning](./01-vision-and-positioning.md) — the strategic thesis
3. [Product Overview](./02-product-overview.md) — what users actually see and do
4. [Roadmap & Phasing](./10-roadmap-and-phasing.md) — what ships when
5. Then drill into the technical and compliance modules as needed
