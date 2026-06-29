# 09 — Compliance & Jurisdictions

## Disclaimer

This module describes the compliance framework Goeman Global Finance will operate under and the obligations it implies. It is not legal advice. Every requirement here will be reviewed and refined by external counsel before launch. Where this document and counsel disagree, counsel wins.

## US regulatory framework

Goeman Global Finance operates in the US under several overlapping regimes:

### Bank Secrecy Act (BSA) and AML

As a money services business (MSB) and (eventually) a custodian of customer funds, Goeman Global Finance is subject to BSA/AML requirements:

- **FinCEN MSB registration** within 180 days of starting operations
- **Customer Identification Program (CIP)** — applies at Tier 2 and above
- **Customer Due Diligence (CDD)** — beneficial ownership identification at Tier 2 for entity accounts
- **Sanctions screening** — OFAC SDN, sectoral sanctions, and consolidated international lists; screen on creation and daily rescreen
- **Suspicious Activity Reports (SARs)** — file with FinCEN within 30 days of detection
- **Currency Transaction Reports (CTRs)** — file for cash transactions over $10K (not applicable to v1 since no cash; relevant when card lands in v2)
- **Travel Rule** — for crypto transfers ≥$3,000, collect and transmit beneficiary information per FinCEN/FATF requirements

### Money Transmission

Moving fiat dollars on behalf of users requires money transmitter licenses (MTLs) in most US states. Two paths:

1. **Sponsor-based** — operate under the MTLs of a sponsor partner (Bridge, Stripe Treasury, Column with its own MTLs). Fastest to market. Used in v1.
2. **Own MTLs** — pursue MTLs state-by-state. ~$2-5M and 12-24 months for full coverage. Pursued in parallel starting at v1; meaningful coverage by v2.

Some states (Wyoming, Nevada, New Hampshire) have crypto-friendly alternative pathways (Wyoming SPDI, Special Purpose Depository Institution). Worth pursuing for the institutional credibility.

### Securities

Listing tokenized securities triggers SEC and FINRA obligations:

- **Reg D 506(c)** — accredited investor securities; verification required, no general solicitation restriction
- **Reg A+** — small public offering; available to non-accredited but capped at $75M/year
- **Reg S** — non-US offerings; only available to non-US persons
- **Alternative Trading System (ATS)** — to provide secondary trading of securities, we partner with an ATS-registered broker-dealer (Securitize Markets, tZERO, or similar) rather than registering ourselves in v1

### Stablecoin and crypto

- **GENIUS Act (2025)** — provides federal framework for stablecoin issuers. Goeman Global Finance does not issue a stablecoin in v1; we use USDC issued by Circle (which is compliant). If we ever issue our own, we register under GENIUS.
- **SEC custody guidance** — applies to crypto held on behalf of clients. Our non-custodial model substantially reduces but does not eliminate our exposure here.
- **CFTC** — for any commodity-related tokenization (gold via PAXG); we follow Paxos's regulatory framework

### State-level

- **NY BitLicense** — required to operate in NY for crypto activities. Approximately $100K-200K to obtain and significant ongoing compliance overhead. **NY is excluded from v1**; reassessed for v2 once we have revenue to justify the cost.
- **California, Texas, Washington** — generally accessible without state-specific crypto licensing beyond MTL.

### Banking

In v1, we do not hold a bank charter. Funds are held at a partner bank (Column or similar). The partner bank's banking compliance posture covers us at the deposit level. We are responsible for our own AML/KYC, transaction monitoring, and consumer protection (UDAAP, Reg E, etc.).

## International regulatory framework

Each launch corridor has its own regulatory picture. Detailed analysis lives with counsel; this section summarizes the posture.

### Nigeria

- **CBN (Central Bank of Nigeria)** has historically been cautious on crypto; the situation has evolved through 2024-2025 toward a more permissive licensing regime
- **SEC Nigeria** regulates security tokens
- **Operating model:** partner with a CBN-licensed payment service provider (Flutterwave-tier) for fiat rails; operate the wallet and marketplace through a Goeman Global Finance Nigerian entity registered as a fintech
- **Risk:** policy reversal. Mitigated by ability to fall back to USDC-only operation for Nigerian users

### Philippines

- **BSP (Bangko Sentral ng Pilipinas)** licenses Virtual Asset Service Providers (VASPs); friendly regime
- **SEC Philippines** regulates security tokens
- **Operating model:** register as a VASP with BSP; partner with GCash or Coins.ph for local rails
- **Risk:** corridor-specific KYC requirements may exceed Tier 2

### Brazil

- **BACEN (Banco Central do Brasil)** has explicit crypto/virtual asset regulations under Law 14,478 (2022); requires registration for VASPs
- **CVM** regulates security tokens
- **Operating model:** register as VASP; integrate Pix for instant settlement
- **Risk:** complex tax obligations (IOF, IR) on FX flows; requires local tax advisor

### General international approach

- **One operating entity per jurisdiction** where required; otherwise serve via a regional hub entity
- **Local KYC partners** where global vendors don't have native coverage
- **Jurisdiction-specific terms of service** delivered at signup based on user's detected location
- **OFAC + local sanctions screening** at every tier

## Jurisdiction availability matrix

The user-facing implication: every product feature has a jurisdiction availability flag. The matrix is a first-class data model maintained in our admin console.

Example slice for v1:

| Feature | US | Nigeria | Philippines | Brazil | Sanctioned (Iran, NK, etc.) |
|---|---|---|---|---|---|
| Tier 0 signup | ✅ | ✅ | ✅ | ✅ | ❌ |
| Receive USDC | ✅ | ✅ | ✅ | ✅ | ❌ |
| Send USDC (P2P) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Browse marketplace | ✅ | ✅ | ✅ | ✅ | ❌ |
| Buy collectibles | ✅ (Tier 1+) | ✅ (Tier 1+) | ✅ (Tier 1+) | ✅ (Tier 1+) | ❌ |
| Buy treasuries (BUIDL) | ✅ (Tier 2+) | ✅ (Tier 2+, qualified) | ✅ (Tier 2+, qualified) | ✅ (Tier 2+, qualified) | ❌ |
| Buy Reg D securities | ✅ (Tier 3) | ❌ (US-only Reg D) | ❌ | ❌ | ❌ |
| ACH deposit/withdraw | ✅ (Tier 2+) | ❌ | ❌ | ❌ | ❌ |
| Pix corridor | ❌ | ❌ | ❌ | ✅ (Tier 1+) | ❌ |
| GCash corridor | ❌ | ❌ | ✅ (Tier 1+) | ❌ | ❌ |
| Mobile money (M-Pesa) | ❌ | TBD | ❌ | ❌ | ❌ |

The matrix is enforced at the API gateway based on the user's verified jurisdiction (from KYC at Tier 2+, IP-based for Tier 0/1 with explicit acknowledgment).

## Sanctions and screening

### Screening sources

- **OFAC SDN List** (US Treasury)
- **OFAC Consolidated Sanctions List**
- **UN Security Council Consolidated List**
- **EU Consolidated Financial Sanctions List**
- **HM Treasury (UK) Consolidated List**
- **Local sanctions lists** per operating jurisdiction
- **Blockchain analytics**: TRM Labs and/or Chainalysis for on-chain address screening

### Screening cadence

| Trigger | Action |
|---|---|
| User signup (Tier 0) | IP geolocation + device check against sanctioned countries |
| User Tier 1 verification (phone) | Phone country code check; phone hash against sanctions lists |
| User Tier 2 verification (KYC) | Full name + DOB + address screened against all sanctions lists |
| User existing account | Daily rescreen of Tier 2+ accounts; weekly rescreen of Tier 0/1 by phone/email/device |
| Inbound on-chain transfer | Source address screened against TRM/Chainalysis risk database |
| Outbound on-chain transfer | Destination address screened |
| Inbound fiat transfer | Sender bank account screened |
| Outbound fiat transfer | Recipient bank account screened |
| Marketplace counterparty | Both buyer and seller screened in real-time before trade execution |

### Hit handling

- **Confirmed sanctions match:** account frozen immediately, funds quarantined, OFAC blocking report filed within deadlines
- **Possible match (name fuzz):** account placed in "pending review" state; agent gathers context; human compliance officer decides within 24 hours
- **High-risk indicator (without confirmed match):** enhanced due diligence triggered; user may be asked for additional information

## Transaction monitoring

A separate system from sanctions screening; looks at patterns rather than identities.

**Vendor:** Comply Advantage, Hummingbird, or similar (final selection in Module 11)

**Rules in v1 (illustrative):**
- Inbound + outbound velocity exceeding configured thresholds for a user's tier
- Round-number transactions clustering (potential structuring)
- Rapid in-and-out (potential pass-through)
- Counterparty risk score above threshold (blockchain analytics)
- First transaction immediately followed by large transaction (potential mule account)
- Geographic anomalies (transaction from country inconsistent with KYC)

**Alert handling:** agent first-pass triage (Module 08), then human compliance officer for disposition. Disposition options: clear, request more info, freeze pending investigation, file SAR.

## Privacy and data protection

### Frameworks

- **US:** GLBA (financial privacy), CCPA/CPRA (California), various state-level
- **EU:** GDPR (when EU users come online, v2)
- **Nigeria:** NDPR (Nigeria Data Protection Regulation)
- **Brazil:** LGPD
- **Philippines:** Data Privacy Act

### Implementation

- All PII encrypted at rest with field-level encryption
- All PII access logged; admin access to user PII requires step-up and is fully audited
- User-initiated data export and deletion supported (consistent with regulatory retention requirements — financial records are retained 5-7 years even on deletion request)
- Cross-border data transfer subject to applicable framework (Standard Contractual Clauses for EU; Adequacy assessments where applicable)

## Audit and reporting

### Internal audit

- **Audit log** (Module 07) captures every state-changing operation across all services
- **HCS anchor** provides cryptographic immutability for the audit log
- **Daily reconciliation** between our ledger and external systems (Hedera Mirror Node, partner bank, corridor partners)
- **Weekly review** by internal compliance team of: agent decisions, manual KYC reviews, sanctions hits, transaction monitoring dispositions

### External audit

- **SOC 2 Type II** audit begins at launch; target completion 12 months
- **Annual financial audit** by Big 4 firm beginning year one
- **Penetration testing** annually by external security firm
- **Smart contract audits** for any contracts Goeman Global Finance deploys (ERC-3643 implementations, escrow contracts, paymaster, multisig)
- **AML independent review** annually per FinCEN guidance

### Regulatory reporting

| Report | Frequency | Recipient |
|---|---|---|
| SAR (Suspicious Activity Report) | As needed, within 30 days of detection | FinCEN |
| CTR (Currency Transaction Report) | Per transaction over $10K (when card lands v2) | FinCEN |
| OFAC blocking report | As needed, within 10 days of blocking | OFAC |
| State MTL reports | Per state requirement (typically quarterly) | State regulator |
| Tax forms (1099 series for US users) | Annual | IRS + users |
| FATCA / CRS reporting | Annual | IRS (FATCA) / local tax authority (CRS) |

## Consumer protection

### Required disclosures

- Terms of Service, Privacy Policy, E-Sign consent — at signup
- Asset-specific disclosures — on every marketplace listing (risk factors, fees, issuer info)
- Regulation E disclosures — for any USD-denominated electronic transfers (v2 card)
- Tax obligations — annual reminders to US users about reporting requirements

### Dispute resolution

- **In-app support** first; agent handles common cases (Module 08)
- **Regulation E** disputes for fiat transactions (v2 onward)
- **Chargeback handling** for card transactions (v2 onward)
- **Arbitration clause** in Terms of Service with carve-out for small claims court (standard fintech approach)

## Out of scope for v1 (compliance)

- New York operations (excluded; reassessed for v2)
- EU operations (v2 with proper MiCA framework)
- Asia operations beyond Philippines (v2)
- Institutional / business accounts (v2; different KYC framework)
- Crypto-native lending without securities backing (regulatory gray area; deferred)
- Tax preparation assistance beyond data export (out of scope by policy)

## Open questions

- `[Q-COMP-001]` Lead jurisdiction for international operating entity — Singapore, BVI, Bermuda, Switzerland?
- `[Q-COMP-002]` Pursue Wyoming SPDI charter immediately or wait for revenue traction?
- `[Q-COMP-003]` Which Travel Rule provider — Notabene, Sumsub, or VerifyVASP?
- `[Q-COMP-004]` Which transaction monitoring vendor — Comply Advantage, Hummingbird, Quantifind?
- `[Q-COMP-005]` Insurance: how much custodial insurance and crime insurance to carry at launch?

## Cross-references

- For how identity tiers map to compliance levels, see [03 — Identity & Onboarding](./03-identity-and-onboarding.md)
- For agent skills supporting compliance work, see [08 — Agent Operations](./08-agent-operations.md)
- For audit log technical implementation, see [07 — Technical Architecture](./07-technical-architecture.md)
