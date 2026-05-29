# Bankai — Product Requirements Document

**Status:** v0.1 draft for review
**Last updated:** May 2026
**Owner:** TBD (Founder / Head of Product)

A tokenization-first neobank with a USDC wallet, a real-world-asset and collectibles marketplace, fiat rails through partner banks, and an agent-operated back office. Hedera as the v1 settlement chain. US and international launch in parallel.

This PRD is a set of linked modules. Read in order if you're new; jump to a specific module by topic.

## Modules

| # | Document | Audience | Status |
|---|---|---|---|
| 00 | [Executive Summary](./00-executive-summary.md) | Everyone | Draft |
| 01 | [Vision & Positioning](./01-vision-and-positioning.md) | Founders, investors, leadership | Draft |
| 02 | [Product Overview](./02-product-overview.md) | Product, design, engineering | Draft |
| 03 | [Identity & Onboarding](./03-identity-and-onboarding.md) | Product, compliance, engineering | Draft |
| 04 | [Wallet & Custody](./04-wallet-and-custody.md) | Engineering, compliance | Draft |
| 05 | [Tokenization & Marketplace](./05-tokenization-and-marketplace.md) | Product, engineering, partnerships | Draft |
| 06 | [Payments & Rails](./06-payments-and-rails.md) | Product, partnerships, compliance | Draft |
| 07 | [Technical Architecture](./07-technical-architecture.md) | Engineering, SRE | Draft |
| 08 | [Agent Operations](./08-agent-operations.md) | Engineering, operations, AI team | Draft |
| 09 | [Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md) | Legal, compliance, product | Draft |
| 10 | [Roadmap & Phasing](./10-roadmap-and-phasing.md) | Leadership, engineering | Draft |
| 11 | [Open Questions & Risks](./11-open-questions-and-risks.md) | Everyone | Draft |

## Locked decisions

These are committed and do not need to be re-litigated when reading the modules. The reasoning behind each is in the relevant module.

- **Blockchain:** Hedera single-chain for v1; multi-chain (Ethereum L2 + Solana via Corda Protocol) post-scale
- **Token standards:** ERC-3643 on HSCS for securities; HTS native for collectibles and stablecoin operations
- **Wallet infrastructure:** Native build on Hedera SDKs (Go server-side, Swift on iOS, Kotlin on Android). Keys in Apple Secure Enclave / Android Keystore; server-side passkey-encrypted backup for recovery. Vendor key-custody layer (Fireblocks Dynamic or equivalent) re-evaluated for v2 if institutional partners require it.
- **Stablecoin:** USDC primary; USDT secondary
- **Backend language:** Go
- **Orchestration:** Temporal for money-movement workflows; Conductor OSS for agent workflows
- **Mobile:** Native Swift (iOS) and Kotlin (Android) — both at launch
- **Web:** Next.js 15 with App Router
- **Auth:** Passkey-first on mobile and web; SMS OTP as constrained recovery channel
- **Launch geography:** US and international (Nigeria, Philippines, Brazil priority) in parallel
- **Marketplace surfaces:** Securities-style RWAs + physical collectibles + Web3-native gaming assets
- **KYC model:** Tiered identity ladder; users tier up only when a feature gate requires it

## Open decisions (see Module 11)

- Partner bank selection (Column vs Lead vs Cross River)
- First-party tokenization partner (Securitize vs Tokeny vs both)
- Capital plan / team sizing for parallel US + international launch
- Brand and product name confirmation (is "Bankai" final?)
- Specific international corridors for v1 (which 3 of: Nigeria, Philippines, Brazil, Indonesia, Mexico)

## Conventions used in this PRD

- **Requirements** are tagged with `[REQ-XXX]` identifiers for cross-referencing.
- **Out-of-scope** items are called out explicitly so they don't creep into v1.
- **Open questions** are flagged `[Q]` and rolled up in Module 11.
- All monetary amounts are stored as **integer base units** (cents for fiat, smallest denomination for tokens). No floats anywhere in the system.
- "v1" means initial public launch. "v2" means first major iteration after launch (~6 months post-v1). "v3" means second iteration (~12 months post-v1).
