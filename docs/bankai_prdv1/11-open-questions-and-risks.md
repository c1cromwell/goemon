# 11 — Open Questions & Risks

This document rolls up every open question (`[Q-XXX-NNN]`) flagged across the PRD modules, organized by decision area and decision-maker. It also lists the material risks to the program with current mitigation posture.

## Open questions

### Identity & onboarding

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-ID-001 | Pseudonymous Bankai handles (e.g., `@alice`) — supported in v1, and if so, are they network-discoverable or contact-list-only? | Product | Phase 1 |
| Q-ID-002 | Final IDV vendor selection — Persona, Onfido, or Stripe Identity | Compliance + Eng | Phase 0 end |
| Q-ID-003 | Tier 0 users in US buying non-security NFTs — allowed with dollar cap, or Tier 1+ required? | Compliance + Legal | Phase 1 |

### Wallet & custody

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-WALLET-001 | External security audit firm selection — Trail of Bits, Cure53, or NCC Group? All three are credible; differentiated by Hedera familiarity (Trail of Bits has done Hedera work) and turnaround time | Eng + Compliance | Phase 0 mid |
| Q-WALLET-002 | Recovery secondary factor — required, or user-configurable? Required gives stronger recovery posture; optional gives smoother onboarding | Product + Compliance | Phase 1 |
| Q-WALLET-003 | Cross-device key sync mechanism — use iCloud Keychain / Google Password Manager attestation directly, or always require server-side backup retrieval? Direct sync is faster but adds platform dependencies | Engineering | Phase 0 end |
| Q-WALLET-004 | v2 swap-in evaluation criteria — at what scale/partner-demand threshold do we evaluate moving to Fireblocks Dynamic or equivalent? Need explicit criteria before Phase 2 to prevent later founder-mode swapping | CEO + Eng | Phase 2 |

### Marketplace

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-MK-001 | First-party tokenization partner for v2 — Securitize, Tokeny, or build in-house with a transfer agent partner? | Product + Compliance | v2 planning |
| Q-MK-002 | Order book vs AMM for secondary collectibles trading | Engineering | Phase 1 |
| Q-MK-003 | Curated drops in v1 or v2? Strong consumer pull but adds complexity | Product | Phase 2 |

### Payments & rails

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-PAY-001 | Final partner bank — Column, Lead, or Cross River | CEO + Compliance | Phase 0 end |
| Q-PAY-002 | Which 3 international corridors at launch — current shortlist Nigeria, Philippines, Brazil; alternatives Mexico, Indonesia, Kenya | CEO + BD | Phase 1 |
| Q-PAY-003 | International on-ramp vendor — Bridge for most, but per-corridor specialists (Yellow Card for Nigeria, dLocal for LatAm) | BD + Eng | Phase 1 |

### Technical architecture

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-TECH-001 | Self-hosted Conductor OSS vs Orkes Cloud | Engineering | Phase 0 |
| Q-TECH-002 | Aurora vs CockroachDB for ledger | Engineering | Phase 0 |
| Q-TECH-003 | Self-hosted Hedera Mirror Node vs managed (Arkhia) | Engineering | Phase 0 |
| Q-TECH-004 | gRPC + Connect vs REST + OpenAPI for external API | Engineering | Phase 0 |

### Agent operations

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-AGENT-001 | LLM provider(s) — Claude primary; do specific skills need specialized models? | Eng + AI | Phase 0 |
| Q-AGENT-002 | Conductor self-host vs Cloud (duplicate of Q-TECH-001) | | |
| Q-AGENT-003 | Real-time customer support agent in v1 or v2 | Product + Compliance | Phase 2 |
| Q-AGENT-004 | Agent access to user PII for support purposes | Compliance + Legal | Phase 1 |

### Compliance & jurisdictions

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-COMP-001 | International operating entity jurisdiction — Singapore, BVI, Bermuda, Switzerland | CEO + Legal | Phase 0 |
| Q-COMP-002 | Wyoming SPDI charter pursuit — immediately or wait for traction | CEO + Compliance | Phase 1 |
| Q-COMP-003 | Travel Rule provider — Notabene, Sumsub, VerifyVASP | Compliance + Eng | Phase 0 end |
| Q-COMP-004 | Transaction monitoring vendor — Comply Advantage, Hummingbird, Quantifind | Compliance + Eng | Phase 0 end |
| Q-COMP-005 | Insurance limits — custodial, crime, E&O, D&O at launch | CFO + Legal | Phase 2 |

### Roadmap

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-ROADMAP-001 | True parallel US + international or US-first with international in v1.5 | CEO | Phase 0 |
| Q-ROADMAP-002 | v2 priority — card, lending, or first-party tokenization first | CEO + Product | Phase 3 |
| Q-ROADMAP-003 | v2 geographic priority — EU or Asia | CEO + BD | Phase 3 |

### Brand

| ID | Question | Decision-maker | When needed by |
|---|---|---|---|
| Q-BRAND-001 | Final product name — is "Bankai" the launch brand? Trademark and domain status | CEO + Legal + Design | Phase 0 |
| Q-BRAND-002 | Visual identity direction — premium institutional vs friendly consumer | Design + CEO | Phase 0 |

## Risk register

Material risks to the program with current mitigation posture. Risks are categorized:

- **CRITICAL** — could kill the company
- **HIGH** — could materially delay or de-scope v1
- **MEDIUM** — manageable but worth active monitoring
- **LOW** — known but acceptable

### Regulatory and compliance risks

| Risk | Category | Mitigation |
|---|---|---|
| Stablecoin regulation reverses GENIUS Act framework | CRITICAL | Diversify across stablecoin issuers (USDC primary, USDT secondary); ability to operate in USDC-pegged TradFi mode if needed |
| US enforcement action against tokenized RWAs we list | HIGH | Work with established issuers (Securitize, Ondo); legal review of every listing; conservative jurisdiction stance (no NY in v1) |
| State MTL application denied or delayed | HIGH | Sponsor-bank model for v1 (Column or partner provides coverage); MTLs in parallel |
| Partner bank changes posture on crypto-adjacent business | HIGH | Backup partner bank under contract; ability to fail over within ~30 days |
| International jurisdiction policy reversal (Nigeria precedent) | HIGH | USDC-only fallback mode per corridor; diversified corridor portfolio |
| SAR backlog or quality issues trigger regulator interest | HIGH | Agent-assisted drafting (Module 08); senior compliance officer review of all filings; clear SLA |
| Travel Rule non-compliance discovered post-launch | MEDIUM | Vendor (Notabene/Sumsub) is industry standard; explicit Travel Rule workflow in payments service |

### Technical and security risks

| Risk | Category | Mitigation |
|---|---|---|
| Hedera network material outage | HIGH | Transaction queue + degraded mode in service layer; visible status to users; v2 multi-chain reduces this risk substantially |
| Native wallet build introduces critical security bug | CRITICAL | Mandatory 2-round external security audit before Phase 2; bug bounty program live at beta; conservative rollout (alpha → 1% beta → full beta); 24-hour wallet circuit breaker; senior security engineer hire in Phase 0; crime/cyber insurance with explicit native-wallet coverage |
| Native wallet build slips beyond Phase 1 audit gate | HIGH | 3-engineer team committed full-time in Phase 0; weekly progress reviews; fallback option to integrate Fireblocks Dynamic for v1 retains ~6 week swap-in path if native build fails audit |
| Hedera SDK or platform secure-element regression breaks signing | HIGH | Version pinning, comprehensive integration test suite, ability to roll forward quickly; relationship with Hedera Foundation for early-warning on breaking changes |
| Recovery flow fails to unlock legitimate user accounts | HIGH | Multiple recovery paths (passkey sync, encrypted backup, manual escalation); user-configurable secondary factors; clear support escalation; agent-assisted manual recovery (Module 08) |
| USDC depeg or Circle issue | HIGH | Chainlink PoR monitoring + circuit breaker; user notifications; USDT as alternative; insurance coverage |
| Smart contract exploit in our deployed contracts | CRITICAL | Multiple audits before deploy; bug bounty program; upgrade path via timelock + multisig; insurance |
| Smart contract exploit in third-party contracts we integrate with | HIGH | DD before integration; limit user exposure per integration; ability to pause specific integrations |
| Key compromise (paymaster or compliance multisig) | CRITICAL | Keys in CloudHSM; multisig requires multiple parties; rotation procedures; alerting |
| DDoS / API abuse attack | MEDIUM | Cloudflare + AWS WAF; rate limiting throughout; capacity to scale during attack |
| Data breach exposing user PII | CRITICAL | Field-level encryption; least-privilege access; HSM-stored keys; SOC 2 / pen test |

### Operational and execution risks

| Risk | Category | Mitigation |
|---|---|---|
| Agent operations don't meet quality bar required for financial product | HIGH | Conservative supervision tiers in v1; ramp auto-approval only with eval data; humans always in loop for material decisions |
| Parallel US + international launch overwhelms organization | HIGH | Clear region leads; shared platform / different go-to-market; explicit decision points where we'd descope one region |
| Hiring difficulty in compliance + crypto-experienced engineering | MEDIUM | Competitive comp; remote-first; relationships with recruiting firms specializing in fintech |
| Partner bank or corridor partner delivery slips | HIGH | Multiple partners per category; explicit deadlines in contracts; ready to drop a phase if partner can't deliver |
| Marketing/PR misstep around no-KYC tier creates regulatory attention | HIGH | PR strategy approved by legal; consistent messaging that emphasizes regulatory compliance |
| Marketplace listings dry up (issuers don't want to list with us) | HIGH | Multiple issuer partners; ability to list third-party assets where compliance allows; first-party tokenization in v2 as backup |
| Cost overruns force descoping | MEDIUM | Phase gates with go/no-go decisions; agent-operated model keeps OpEx low |

### Strategic and competitive risks

| Risk | Category | Mitigation |
|---|---|---|
| Robinhood or PayPal launches competing tokenization marketplace | HIGH | Move fast (12 months to v1); differentiate on global reach + collectibles + agent ops cost structure; brand on tokenization-first |
| Stablecoin loses mindshare to CBDCs | MEDIUM | CBDCs are years away in major markets; architecture supports adding CBDC rails when they exist |
| Tokenized RWAs remain institutional-only | MEDIUM | Collectibles surface gives us consumer pull independent of RWA adoption rate; gaming surface ditto |
| Regulatory regime favors incumbents (banks, broker-dealers) | MEDIUM | Partner bank model means we benefit from their charter; pursuit of own charter in v3 |

### Brand and reputational risks

| Risk | Category | Mitigation |
|---|---|---|
| Major user loses funds (phishing, social engineering) and it goes viral | HIGH | UX defaults to safe; education at signup; agent-detected suspicious activity warnings; clear policy on user-error losses |
| Marketplace listing turns out to be a scam | HIGH | DD process (Module 08) before listing; ability to delist immediately; insurance for material losses |
| AI agent makes high-profile mistake on customer-facing channel | MEDIUM | Strict supervision tiers in v1; explicit "agent-drafted, human-approved" model for external communications |
| Founder or exec public misstep | MEDIUM | Communications training; spokesperson strategy; clear PR escalation playbook |

## Decisions log

This section will be populated as decisions are made. Each entry includes the decision, who made it, when, and the rationale.

### Locked decisions (committed in prior conversations)

| Decision | Made by | Rationale |
|---|---|---|
| Blockchain: Hedera for v1 | Founder | Best institutional credibility + EVM compat + protocol-level AA + USD-pegged fees |
| Multi-chain: deferred to post-launch | Founder | Reduces v1 scope; review when scale justifies multi-chain |
| Embedded wallet: native build on Hedera SDKs (Secure Enclave / Keystore + server-side encrypted backup) | Founder + Eng | Maximum control, zero vendor lock-in, lowest per-MAU cost; Hedera's protocol-level account abstraction makes native build materially simpler than equivalent on EVM; institutional-credibility narrative deferred to v2 review point |
| Backend language: Go | Founder | Performance, single language for backend, strong concurrency for the workload |
| Orchestration: Temporal (money) + Conductor OSS (agents) | Founder + Eng | Best-of-both: Temporal for code-first money workflows, Conductor for agent-orchestrated workflows |
| Mobile: native Swift (iOS) + Kotlin (Android) | Founder | Best UX; team can support both |
| Web: Next.js 15 (App Router) | Founder | Modern framework with good DX and SSR |
| Auth: passkey-first with SMS-OTP recovery | Founder | Best modern auth; SMS only as constrained recovery channel |
| Geography: US and international in parallel | Founder | Bold but defensible given strategic positioning |
| KYC: tiered ladder with on-demand upgrades | Founder | Maximum onboarding speed; capability unlocks per regulatory threshold |
| Marketplace: securities + collectibles + Web3 gaming | Founder | Two-surface approach; collectibles gives consumer pull, securities give AUM |
| Excluded from v1: COD/traditional publisher gaming items | Claude (recommended) | Legally not possible without publisher cooperation |
| Bankai CLI: repurposed as internal admin console | Founder | Preserves prior work as ops/compliance tooling |
