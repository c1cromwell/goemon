# 06 — Payments & Rails

## Scope

This module covers everything that moves money on the user's behalf: stablecoin transfers, fiat on/off ramps in the US, international corridors, and future lending products. The wallet itself is documented in [Module 04](./04-wallet-and-custody.md).

## v1 payment surfaces

| Surface | Available in v1 | Tier required |
|---|---|---|
| Receive USDC on Hedera | ✅ All regions | Tier 0 |
| Send USDC on Hedera (P2P) | ✅ All regions | Tier 0 (with caps) |
| Cross-chain USDC in/out via CCTP | ✅ All regions | Tier 0 |
| US fiat deposit (ACH push) | ✅ US only | Tier 2 |
| US fiat withdrawal (ACH) | ✅ US only | Tier 2 |
| US fiat deposit (wire) | ✅ US only | Tier 2 |
| US fiat withdrawal (wire) | ✅ US only | Tier 2 |
| Debit card | ❌ (v2) | — |
| International on-ramp (local currency → USDC) | ✅ Priority 3 corridors | Tier 1 minimum |
| International off-ramp (USDC → local currency) | ✅ Priority 3 corridors | Tier 1 minimum |
| Lending — collateralized | ❌ (v2) | — |
| Lending — uncollateralized | ❌ (v3) | — |

## US fiat rails

### Partner bank — selection criteria

We need a partner bank that supports:

- FBO ("for benefit of") account structure for pooled customer funds
- ACH (origination and receipt), Same Day ACH, FedNow, wire
- Stablecoin issuance partner or USDC settlement (via Circle relationship)
- Card issuing program (for v2 card)
- Aggressive compliance posture but pragmatic on crypto-adjacent business

Three candidates evaluated:

| Bank | Strengths | Weaknesses |
|---|---|---|
| **Column** | Stripe-aligned, modern API, strong crypto-adjacent posture | Smaller scale; can be selective on partners |
| **Lead Bank** | Card and ACH at scale, banks several major fintechs | Card platform less modern than Column |
| **Cross River** | Mature ACH and BaaS, large fintech client roster | Has had regulatory friction in recent years (resolved but worth noting) |

**Recommendation:** Column for v1. Decision documented in Module 11; final choice pending term-sheet discussions.

### ACH

US users (Tier 2+) can:
- **Deposit** by pushing ACH from their external bank to Argus Financial Partners (one-time or recurring)
- **Withdraw** by initiating ACH from Argus Financial Partners to their linked external bank
- **Convert** between USD balance and USDC balance with one tap (settled by partner bank + Bridge)

**Requirements:**
- `[REQ-PAY-US-001]` ACH deposits credit the user's USD balance after partner bank's NACHA settlement window (typically 1-3 business days for standard, same-day for Same Day ACH)
- `[REQ-PAY-US-002]` ACH withdrawals require external bank account verification (via Plaid microdeposits or instant verification)
- `[REQ-PAY-US-003]` First-time ACH withdrawals to a new external account trigger a 24-hour hold for fraud prevention
- `[REQ-PAY-US-004]` ACH returns (R-codes) are handled automatically; user is notified and balance is adjusted within 1 business day of return

### Wire

For larger amounts (typically >$50K), users can deposit and withdraw via wire. Domestic wires only in v1; international wire in v2.

**Requirements:**
- `[REQ-PAY-US-005]` Wire deposit instructions are generated per user with a unique memo line for automated reconciliation
- `[REQ-PAY-US-006]` Wire withdrawals require step-up auth and a 24-hour delay for first-time recipients
- `[REQ-PAY-US-007]` Wire fees are passed through transparently (partner bank typically charges $15-25 per outbound wire)

### FedNow / RTP

Instant payments via FedNow or The Clearing House's RTP are supported where partner bank participates.

**Requirements:**
- `[REQ-PAY-US-008]` FedNow/RTP deposits are credited within 60 seconds of partner bank confirmation
- `[REQ-PAY-US-009]` FedNow/RTP withdrawals are subject to step-up auth above $10K
- `[REQ-PAY-US-010]` Instant payment limits are configurable per user based on KYC tier and account age

## International corridors

We launch with **three priority corridors** in v1. Final selection in Module 11; current shortlist:

### Nigeria (NGN ↔ USDC)

- **On-ramp partners:** Yellow Card, Onafriq, or direct bank API where available
- **Off-ramp:** Bank transfer (NIBSS Instant Payment) or mobile money (Opay, Palmpay)
- **Why:** Massive remittance corridor, USD-stable savings demand high, existing USD-wallet apps (Kast, Plasma One) have proven product-market fit

### Philippines (PHP ↔ USDC)

- **On-ramp partners:** PDAX, Coins.ph, or GCash via partnership
- **Off-ramp:** GCash, Maya, bank transfer (InstaPay/PESONet)
- **Why:** ~$36B annual remittance inflow, mobile-money native, English-friendly

### Brazil (BRL ↔ USDC)

- **On-ramp partners:** Bridge (good Brazil coverage), dLocal, Pagsmile
- **Off-ramp:** Pix (instant, ubiquitous), bank transfer
- **Why:** Largest LatAm economy, sophisticated digital banking adoption, Pix is best-in-class instant payment infrastructure

### Corridor architecture

Each corridor is implemented as a pluggable connector that supports:
- Local-currency quote API (FX rate with our markup baked in)
- Order placement API
- Settlement webhook
- Refund/cancellation API
- KYC handoff (where the corridor partner requires additional KYC beyond ours)

**Requirements:**
- `[REQ-PAY-INTL-001]` Corridor switching (multiple partners per country) is supported via connector abstraction; primary and fallback partner per corridor
- `[REQ-PAY-INTL-002]` FX rates displayed are end-to-end (all-in price) with markup disclosed transparently
- `[REQ-PAY-INTL-003]` Corridor-specific compliance requirements (e.g., Pix requires CPF, M-Pesa requires Kenyan ID number) are collected in the send flow, not at signup
- `[REQ-PAY-INTL-004]` Failed off-ramps trigger automatic USDC refund within 1 hour with notification to user

## Peer-to-peer USDC

The simplest payment surface — Argus Financial Partners user to Argus Financial Partners user, or Argus Financial Partners user to any external Hedera address.

**Requirements:**
- `[REQ-PAY-P2P-001]` Argus Financial Partners-to-Argus Financial Partners transfers settle in under 5 seconds end-to-end (Hedera finality + our notification latency)
- `[REQ-PAY-P2P-002]` Argus Financial Partners-to-external transfers settle at Hedera finality (~3 seconds)
- `[REQ-PAY-P2P-003]` Transfers above Travel Rule threshold ($3K) trigger automatic IVMS 101 data collection via our Travel Rule provider (Notabene or Sumsub)
- `[REQ-PAY-P2P-004]` Sending to a sanctioned address (per TRM Labs / Chainalysis screening) is blocked at submission time with explanatory error
- `[REQ-PAY-P2P-005]` Receiving from a sanctioned address triggers automatic freeze of received funds pending compliance review

## Lending (future)

Lending is out of scope for v1. Documented here for architectural foresight; full requirements come in the v2 PRD.

### v2: Collateralized stablecoin loans

User pledges Argus Financial Partners-held RWA tokens (BUIDL, OUSG, etc.) as collateral; borrows USDC against them. Mechanism:
- Smart contract on HSCS locks the collateral
- USDC is disbursed to user from a Argus Financial Partners liquidity pool
- Liquidation threshold and interest rate set per asset
- Liquidation triggered automatically if LTV breaches threshold
- Interest accrues continuously, repayment optional but reduces LTV

This is a securities-collateralized loan and routes through a regulated entity (US: through partner bank or registered broker-dealer; international: through Argus Financial Partners's local entity per jurisdiction).

### v3: Personal loans and lines of credit

Traditional unsecured consumer lending. Requires:
- State-by-state lending licenses (NMLS) OR partner bank originating
- Underwriting model + alternative data sources
- Servicing platform (collections, statements, dispute handling)
- Tier 4 identity verification

## Card (future)

> **Network strategy note:** the v1/v2 card rides Visa/MC (below). Whether Argus could instead build a
> *new* (non-Visa/MC/Amex) rail — and why the honest answer is "a stablecoin/agent-native rail with a Visa
> bridge, not a frontal assault on card acceptance" — is analyzed in
> [`docs/business/PAYMENT-NETWORK-STRATEGY.md`](../business/PAYMENT-NETWORK-STRATEGY.md).

Debit card is v2. Architecturally:
- Visa or Mastercard BIN sponsored by partner bank
- Card issued physically and virtually
- Real-time authorization through Argus Financial Partners's processor (Marqeta, Lithic, or partner bank's processor)
- Spending pulls from USD balance with optional USDC-to-USD instant conversion
- Rewards in USDC for v2 launch

## Operational guarantees

| Operation | P50 latency | P99 latency | Settlement finality |
|---|---|---|---|
| USDC receive (on-chain → app shown) | 3s | 8s | Hedera consensus (~3s) |
| USDC send (Argus Financial Partners→Argus Financial Partners) | 4s | 10s | Hedera consensus + our DB |
| USDC send (Argus Financial Partners→external) | 4s | 10s | Hedera consensus |
| CCTP cross-chain | 13min | 30min | Circle CCTP V2 (chain-dependent) |
| US ACH deposit | 1 business day | 3 business days | NACHA settlement |
| US ACH withdrawal | 1 business day | 3 business days | NACHA settlement |
| US wire | 30 min | 4 hours | Same business day |
| FedNow / RTP | 60s | 5 min | Real-time gross settlement |
| Pix (Brazil) | 60s | 5 min | Pix network |
| GCash (PH) | 60s | 5 min | GCash network |
| M-Pesa (Kenya) | 2 min | 10 min | M-Pesa network |

## Out of scope for v1

- Debit/credit card
- Lending of any kind
- Bill pay
- Direct deposit setup (no user routing/account numbers in v1)
- Check deposit
- ATM withdrawal
- Apple Pay / Google Pay funding source for card (no card in v1)
- Recurring transfers
- Payment requests / invoices (v2)
- Merchant payments (v2)
- Crypto trading (we are not an exchange — see [Module 01](./01-vision-and-positioning.md))

## Cross-references

- For wallet integration with payment rails, see [04 — Wallet & Custody](./04-wallet-and-custody.md)
- For compliance and Travel Rule mechanics, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
- For technical implementation of payment workflows in Temporal, see [07 — Technical Architecture](./07-technical-architecture.md)
