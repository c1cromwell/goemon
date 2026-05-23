# 10 — Roadmap & Phasing

## Phasing principles

- **v1 ships a minimum lovable product, not a minimum viable product.** Launching with a thin product against Robinhood/Revolut doesn't work. We launch with a marketplace that has real assets, a wallet that actually works, and rails that move real money — or we don't launch.
- **Compliance and partner work runs ahead of engineering.** The slowest path through this product is the regulatory and partnership path, not the engineering path. We start those workstreams on day 1 even though they don't produce user-visible output for 6+ months.
- **International and US run in parallel from the start.** Sequencing them would add 6 months to whichever comes second, and the agency-bias is always to keep delaying the "next" region. Doing them together forces architectural decisions (jurisdiction-aware everything) that we'd regret making later.
- **No new categories in v1.x.** Once we ship v1, the first six months are about scaling what works, not adding new product surfaces. v2 is the next category expansion.

## Phase 0 — Foundation (months 0-3)

Concurrent workstreams; no user-visible output.

**Legal and compliance:**
- Engage outside counsel (US + each launch corridor)
- Initiate partner bank conversations (Column primary, Lead Bank backup)
- Begin MTL applications in priority states (sponsor-bank covers initially)
- Register Bankai entity per jurisdiction
- Draft Terms of Service, Privacy Policy, asset-specific disclosure templates

**Partnerships:**
- Securitize / Tokeny — RWA issuance partnership LOIs
- Courtyard / Collector Crypt — collectibles partnership
- 2-3 Web3-native gaming partners (Off The Grid, Shrapnel, Parallel)
- Off-ramp partners per international corridor

**Engineering:**
- Hire team (engineering, design, compliance, ops)
- Stand up infrastructure (AWS, Kubernetes, Postgres, Temporal, Conductor)
- Implement core services skeletons (Auth, Wallet, Ledger, Marketplace)
- **Begin native wallet build** — 3-engineer team (backend + iOS + Android), Hedera SDK integration, Secure Enclave / Keystore key management, server-side encrypted backup architecture; targets Phase 1 alpha completion with external security audit between Phase 1 and Phase 2
- Bootstrap internal admin console (repurposed Bankai CLI)
- Hedera testnet integration end-to-end

**Product and design:**
- High-fidelity design system across iOS, Android, web
- Onboarding flow prototyping and user testing
- Marketplace UX prototyping

## Phase 1 — Closed alpha (months 4-7)

A small group of insider users (employees, advisors, ~100 beta users) on a limited-functionality build.

**User-visible:**
- Tier 0 signup with passkey
- USDC receive/send on Hedera (mainnet, real funds, with paymaster sponsorship)
- Marketplace surface visible but read-only (~5 listings)
- Internal admin console for back-office

**What we learn:**
- Onboarding funnel real-world performance
- Wallet UX with real money
- Operational load (support tickets, agent performance baseline)

**Gate to next phase:** Tier 0 signup completion ≥80%, zero security incidents, agent-handled support at <5 min response time, **first external security audit of native wallet stack completed with no critical findings unresolved**

## Phase 2 — Open beta (months 8-11)

Public-but-waitlisted; ~10K users invited from the waitlist.

**User-visible:**
- Full marketplace with ~10 securities listings + ~200 collectibles + 4 gaming integrations
- Tier 1 verification (phone + email)
- Tier 2 verification (mDL, IDV, Apple/Google Wallet)
- Marketplace purchase end-to-end (collectibles only initially; securities added mid-phase)
- US ACH deposit/withdraw via partner bank
- One international corridor live (priority: Nigeria due to USD demand)

**What we learn:**
- KYC funnel performance
- Marketplace conversion (browse → purchase)
- Real fraud and compliance incident rates
- Agent performance at scale

**Gate to next phase:** zero material compliance incidents, marketplace GMV ≥ $1M, support cost per user ≤ $1.50/MAU

## Phase 3 — Public launch (month 12)

Open access, public marketing. This is v1 launch.

**User-visible:**
- Everything from Phase 2
- All three international corridors live (Nigeria, Philippines, Brazil)
- Tier 3 (accredited investor) for Reg D listings
- Wire transfer in addition to ACH (US)
- Cross-chain USDC via CCTP (Ethereum, Base, Polygon)
- Public marketing campaigns

**Success criteria for v1:**
- 100K signups within 90 days of launch
- $10M+ marketplace GMV in first 90 days
- Zero major security incidents
- Tier 2 conversion rate ≥60% of users who attempt
- Customer support CSAT ≥4.2/5

## v2 — Bank product expansion (months 12-18)

What ships post-launch, in priority order:

### v2.1 — Card (months 12-15)

- Visa or Mastercard debit card (virtual + physical)
- BIN sponsored by partner bank
- USD spending with optional USDC auto-conversion
- Rewards in USDC
- Apple Pay / Google Pay integration

### v2.2 — Lending (collateralized) (months 14-17)

- Pledge RWA holdings as collateral
- Borrow USDC against collateral
- LTV monitoring, automatic liquidation
- Available initially to Tier 2 users with eligible collateral

### v2.3 — First-party tokenization (months 15-18)

- Bankai issues its own RWA tokens (specific assets TBD based on Phase 3 demand signals)
- ERC-3643 contracts on HSCS
- Securitize partnership for transfer agent services (or build in-house)
- Primary issuance UX in marketplace

### v2.4 — Geographic expansion (months 14-18)

- EU launch (one country at a time; UK or Switzerland first, then EU member states under MiCA)
- Asia expansion (Indonesia, Vietnam after Philippines stabilizes)
- LatAm expansion (Mexico, Argentina after Brazil stabilizes)
- Additional African corridors (Kenya, Ghana, Egypt)

### v2.5 — Additional asset categories

- Auctions for collectibles
- Curated drops (limited edition releases)
- Tokenized equities (international markets only initially)
- Music and royalty assets (broader catalog)

## v3 — Bank charter and lending expansion (months 18-30)

- Pursue bank charter (Wyoming SPDI or OCC fintech charter) or sponsor-bank acquisition
- Uncollateralized personal loans (Tier 4 identity)
- Lines of credit
- Business accounts (different KYC, different product)
- Investment advice / robo-advisor (if regulatory posture and team allow)

## v4 — Platform plays (year 3+)

- API platform for third-party developers
- White-label tokenization for issuers
- B2B services (custody, settlement) for institutional clients
- Cross-border payment rails sold as infrastructure

## Hiring plan

Approximate team size at each phase:

| Phase | End-of-phase team size | Composition |
|---|---|---|
| Phase 0 | 12-15 | 6 eng, 2 design, 2 product, 1 compliance, 1 BD, 1-3 ops |
| Phase 1 | 20-25 | 10 eng, 3 design, 3 product, 2 compliance, 2 BD, 1-5 ops |
| Phase 2 | 30-40 | 15 eng, 4 design, 4 product, 3 compliance, 3 BD, 1-11 ops |
| Phase 3 (v1 launch) | 40-55 | 20 eng, 5 design, 5 product, 4 compliance, 4 BD, 2-17 ops + customer success |
| v2 (post-launch year 1) | 60-90 | scaled across all functions |

Engineering composition:
- Backend (Go): ~40%
- Mobile (Swift + Kotlin): ~25%
- Web (Next.js): ~15%
- Platform / SRE / Security: ~15%
- ML / Agent ops: ~5%

## Capital plan

This is illustrative; specific numbers depend on actual hiring market and partnership terms.

| Phase | Cumulative spend (estimate) | Primary cost drivers |
|---|---|---|
| Phase 0 (3 months) | $2-4M | Salaries, legal, partner deals, infra setup |
| Phase 1 (4 months) | $6-10M | Growing team, MTL applications, security audits |
| Phase 2 (4 months) | $12-18M | Growing team, marketplace inventory, soft launch |
| Phase 3 (launch, 6 months runway) | $25-40M | Full team, marketing budget, ongoing partner fees |
| v2 (year 2 ops + growth) | $40-70M | Card program, lending capital, geographic expansion |

Implied funding milestones: Seed → Series A by Phase 2; Series B by v2.

## Out of scope (across all phases)

These are explicit "we are not building this" decisions:

- **A crypto exchange** — no spot trading of speculative tokens (BTC/ETH spot is reconsidered as a v3 product but only if regulatory and brand positioning support it)
- **DeFi protocol** — we use DeFi for some collateral/lending mechanics but don't build a DeFi protocol
- **An NFT mint platform** — users can't mint arbitrary NFTs through Bankai
- **A wallet for general crypto** — Bankai is specifically a bank + marketplace, not a Trust Wallet competitor
- **Robo-advisory** — out of scope by policy through v2; reconsidered for v3
- **Crypto card with stake-to-earn or yield gimmicks** — out of scope by policy

## Open questions

- `[Q-ROADMAP-001]` Phase order — should we ship US-only v1 and add international in v1.5, or true parallel launch? Decision documented as "parallel" but the cost difference is substantial
- `[Q-ROADMAP-002]` Which v2 ships first — card, lending, or first-party tokenization? Each has different time-to-revenue
- `[Q-ROADMAP-003]` Geographic priority for v2 — EU (UK first) or Asia (Indonesia first)?

## Cross-references

- For what ships in v1 in detail, see [02 — Product Overview](./02-product-overview.md)
- For partner dependencies that gate phases, see [06 — Payments & Rails](./06-payments-and-rails.md) and [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
- For team and skill ramp-up implications, see [08 — Agent Operations](./08-agent-operations.md)
