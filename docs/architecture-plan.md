# Bank AI — Full-Stack Architecture Plan

## Context

**Why this exists:** Expanding an existing CLI-first agentic banking app (Python + Typer + Claude SDK) into a production-grade financial platform. The platform must handle tokenized real-world assets (real estate funds, commercial buildings, businesses, commodities), a marketplace to buy/sell/transfer them, mobile wallet (iOS/Android) and web app for asset/USDC visibility, and a robust identity/auth layer including mDL, Verifiable Credentials, passkeys, and biometrics.

**Intent:** Production app — real users, real money, real compliance (securities law, money transmitter licensing, KYC/AML).

**Starting point:** Only `CLAUDE.md` and `.claude/settings.local.json` exist. No code has been written yet.

**Key decisions locked in:**
- Python CLI agent retained, wrapped in FastAPI (not rewritten)
- All four surfaces: Python CLI, Web (Next.js), Mobile (React Native/Expo), Smart Contracts
- First RWA asset classes: real estate fund, commercial buildings, businesses (gyms), commodities
- **Blockchain: Hedera Hashgraph (primary) → Base L2 (Phase 5 multi-chain via Chainlink CCIP)**
- USDC only for settlement (native Circle USDC on Hedera, live March 2025)
- Chainlink as oracle/interoperability layer (Proof of Reserve, Data Feeds, CCIP)

---

## Monorepo Structure

```
bankai/                              ← root (pnpm workspaces + Turborepo)
├── CLAUDE.md                        ← update with full architecture
├── package.json                     ← root workspace config
├── pnpm-workspace.yaml
├── turbo.json
│
├── apps/
│   ├── web/                         ← Next.js 14 App Router (TypeScript)
│   ├── mobile/                      ← React Native + Expo SDK 51 (TypeScript)
│   ├── backend/                     ← NestJS (TypeScript) — API gateway + all services
│   └── agent/                       ← existing Python CLI + new FastAPI HTTP wrapper
│
└── packages/
    ├── contracts/                   ← Hardhat + Solidity (ERC-3643 RWA tokens)
    └── shared-types/                ← TypeScript types shared across apps
```

---

## Blockchain Decision: Hedera Hashgraph

### Why Hedera over Base, Constellation, ETH Mainnet, and Solana

The user has direct experience with Constellation, Ethereum, and Hedera. Research across Ondo Finance, Centrifuge, and the current RWA market confirms Hedera is the correct primary chain for this production use case.

| Criterion | Hedera | Base L2 | Constellation | Solana |
|---|---|---|---|---|
| Native USDC (Circle-issued) | ✓ (Mar 2025) | ✓ | ✗ (bridge only) | ✓ |
| Transaction cost | **$0.0001** | $0.05 | Unknown | $0.00025 |
| Finality speed | **3 sec (deterministic aBFT)** | 5 sec | Unknown | 12.8 sec |
| Institutional RWA TVL | $10B+ | Smaller | <$100M | $1.1B |
| Enterprise governance | **31-member council** (Google, IBM, Boeing, FedEx) | None | None | None |
| Compliance standard | HTS native + ERC-3643 | ERC-3643 | Custom/early | Token-2022 (emerging) |
| Chainlink CCIP | ✓ (41+ chains) | ✓ | Early | ✓ |
| Live RWA reference | RedSwan ($5B+ RE), Archax (BlackRock/Fidelity MMFs) | Centrifuge (May 2026) | None | Franklin Templeton, Ondo |
| User's prior experience | ✓ | — | ✓ | — |

**Decisive factors:**
- Hedera's 31-member governing council (Google, IBM, Boeing, Standard Bank) gives institutional and regulatory credibility that no other chain matches for US securities
- $0.0001/tx makes marketplace-scale settlement economically viable without gas sponsorship complexity
- Deterministic 3-second aBFT finality — no theoretical reversion risk, critical for securities settlement
- RedSwan ($5B+ real estate on Hedera) and Archax (BlackRock/Fidelity money market funds) are exact reference implementations for this platform's asset classes
- Native USDC live on Hedera since March 2025
- Hedera Asset Tokenization Studio (ATS) — Hedera-built toolkit for compliant RWA tokenization
- **The user already knows Hedera** — existing knowledge accelerates development

**Constellation ruled out:** No production institutional RWA deployments; USDC requires bridge (not native); developer ecosystem too early for a production financial platform.

**Base L2 retained as Phase 5 multi-chain expansion** via Chainlink CCIP — Centrifuge just launched a DeFi tokenization framework on Base (May 2026), making it the right secondary target for DeFi composability.

---

### Chainlink Integration (All Three Products)

Chainlink is not a blockchain choice — it is the **mandatory oracle and interoperability layer** regardless of chain. All major RWA platforms (Ondo, Backed, Superstate, OpenEden) use Chainlink. It is live on Hedera.

| Chainlink Product | Use in This Platform |
|---|---|
| **Proof of Reserve (PoR)** | Automated on-chain verification that each RWA token is backed by real assets. Circuit-breaker halts minting if reserves fall below backing. Required for institutional investor confidence. |
| **Data Feeds** | Real-time pricing for commodity tokens (gold, silver). NAV feeds for fund tokens. Institutional-grade data, not our own oracles. |
| **CCIP** | Phase 5: bridge RWA tokens from Hedera → Base/Ethereum for DeFi composability. 41+ chains accessible. Privacy-preserving mode for institutional trades. |
| **Chainalysis Oracle** | OFAC/sanctions screening on wallet addresses at transaction time (pattern from Ondo) |

---

### Patterns from Ondo Finance, Centrifuge, and Chainlink

**From Ondo Finance:**
- Compliance enforced **at the token transfer function** (allowlist + blocklist + sanctions oracle called on every transfer) — not as external middleware. This is legally stronger and cannot be bypassed.
- **Non-rebasing tokens**: yield via price appreciation, not token count increase. Simpler tax accounting, no precision loss.
- Upgradeable proxy pattern (EIP-1967) for post-audit contract improvements without disrupting balances.
- KYC off-chain (Persona/mDL) + on-chain allowlist registration = two-layer compliance.

**From Centrifuge:**
- **ERC-7540 (async vault)**: Real-world asset settlement takes days. Use request/claim cycle, not synchronous ERC-4626. Critical for real estate and business asset classes.
- **TIN/DROP tranche model**: Issue two token classes per asset pool — senior (DROP, lower risk/yield) and junior (TIN, first-loss, higher yield). Attracts both conservative and aggressive capital.
- **NFT collateral → ERC-20 pool tokens**: Real-world assets tokenized as NFTs → mortgaged into pool → pool issues ERC-20 investment tokens. Clean separation between asset representation and investor share.
- **Multi-chain hub-spoke**: One pool, multiple chain entry points. Implement via Chainlink CCIP.

**From Chainlink's institutional playbook:**
- Proof of Reserve is non-negotiable for institutional credibility — build it in Phase 1, not Phase 5.
- Swift integration (ISO 20022 messaging → on-chain) is the path to traditional finance distribution. Plan for it in Phase 5.

---

## Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| **Primary blockchain** | **Hedera Hashgraph** | $0.0001/tx, 3-sec finality, 31-member council, $10B+ RWA TVL, native USDC |
| **Secondary blockchain** | Base L2 (Phase 5) | DeFi composability, Centrifuge ecosystem, Chainlink CCIP bridge target |
| RWA token standard | ERC-3643 (T-REX) on Hedera EVM | $32B+ institutional use; on-chain compliance enforcement; Hedera EVM is EVM-compatible |
| Token architecture | NFT (asset) → ERC-7540 async vault → ERC-20 pool shares | Centrifuge pattern; handles real-world settlement delays |
| Tranche model | TIN (junior) / DROP (senior) per asset pool | Centrifuge pattern; attracts diverse investor risk profiles |
| Oracle layer | Chainlink (PoR + Data Feeds + CCIP) | Industry standard; live on Hedera; used by Ondo, Backed, Superstate |
| Wallet infra | Privy (MPC embedded wallet) | Biometric binding on mobile, passkey binding on web, no user key management |
| USDC operations | Circle Programmable Wallets | Native USDC on Hedera, gas abstraction, AML hooks |
| Chain SDK | Hedera TypeScript SDK + Hedera EVM (Hardhat) | Native HTS for simple ops; Solidity/ERC-3643 for compliance contracts |
| Block explorer | HashScan (hashscan.io) | Hedera's native explorer |
| Backend | NestJS (TypeScript) | DI, module architecture maps to service boundaries |
| Web | Next.js 14 App Router | Server Components for dashboard/marketplace, Client for agent chat + passkey |
| Mobile | React Native + Expo | Single codebase iOS/Android; `expo-local-authentication`, `expo-secure-store` |
| Database | PostgreSQL + Prisma ORM | Full ACID, scales to production |
| Cache/sessions | Redis | Session tokens (TTL-based), idempotency keys, rate limits, event streams |
| Auth (web) | WebAuthn via `@simplewebauthn/server` | No vendor lock-in, W3C standard passkeys |
| Auth (mobile) | Privy SDK + `expo-local-authentication` | Biometric unlocks MPC key share |
| IDV primary | Persona | Document scan + selfie, liveness, AML screening, webhooks |
| IDV fast-path | Apple ID Verifier API (mDL) | NFC tap of Apple Wallet Digital ID on iOS |
| VC / DID | Veramo (`did:hedera:<accountId>`) | TypeScript-native, W3C VC standard, maps to Hedera account ID |
| Python agent | FastAPI HTTP wrapper | Bridges NestJS → existing Python CLI agent via `POST /agent/chat` |
| Contract toolchain | Hardhat + TypeChain + Hardhat Ignition | EVM-compatible; Hedera supports Solidity via JSON-RPC relay |
| Sanctions screening | Chainalysis oracle (on-chain, Ondo pattern) | OFAC check at token transfer level, not just at onboarding |

---

## Service Boundaries (within NestJS monolith, extractable later)

```
NestJS AppModule (API Gateway — JWT guard, rate-limit guard)
│
├── AuthModule          — passkey/WebAuthn, JWT issuance, refresh rotation, step-up
├── IdentityModule      — KYC orchestration, Persona, Apple mDL, Veramo VC issuance
├── WalletModule        — Privy provisioning, Circle USDC wallets, Alchemy balance reads
├── MarketplaceModule   — assets, listings, orders, settlement, compliance checks
├── AgentProxyModule    — HTTP proxy to Python FastAPI agent-service
└── EventsModule        — Alchemy Notify webhooks → Redis Streams → GraphQL subscriptions
```

---

## Smart Contract Architecture (`packages/contracts/`)

Hedera EVM is fully Solidity-compatible via its JSON-RPC relay. Hardhat targets Hedera testnet/mainnet exactly as it would any EVM chain. ERC-3643 (T-REX) contracts deploy unchanged.

### Token Architecture (Centrifuge-inspired)

```
Real-World Asset (legal entity / deed / custody receipt)
        ↓
  AssetNFT.sol (ERC-721)           ← represents the real asset, held by platform
        ↓
  RWAPool.sol (ERC-7540 vault)     ← async deposit/withdrawal; handles real-world settlement delays
        ↓
  DROP token (ERC-20, ERC-3643)   ← senior tranche: lower risk, lower yield
  TIN token  (ERC-20, ERC-3643)   ← junior tranche: first-loss, higher yield
```

**Why ERC-7540 (not ERC-4626):** Real estate fund redemptions, building sales, and business exits take days to settle. ERC-7540's request/claim cycle matches real-world timelines. Pure synchronous ERC-4626 would require keeping 100% liquidity on-chain — economically impossible for RWAs.

### Contracts

**`AssetNFT.sol`**
ERC-721 representing a single real-world asset (one per property, business, or commodity lot). Minted by platform admin wallet. Metadata points to IPFS-stored legal documents (prospectus, deed, custody receipt). Held in `PlatformTreasury` as collateral for the pool.

**`RWAPool.sol`** *(one deployment per asset offering)*
ERC-7540 async vault. Implements request/claim cycle:
- `requestDeposit(assets, receiver)` — investor requests USDC deposit
- Platform processes off-chain (KYC check, asset allocation)
- `claimDeposit(requestId)` — investor claims DROP/TIN tokens after settlement window
- `requestRedeem(shares, receiver)` — investor requests exit
- `claimRedeem(requestId)` — investor claims USDC after asset liquidation

**`IdentityRegistry.sol`**
ERC-3643 ONCHAINID registry. Maps user wallet → identity contract. Claims: `KYC_PASSED`, `ACCREDITED_INVESTOR`, `COUNTRY_CODE`. Written by `IdentityModule` backend wallet after KYC pass.

**`RWAToken.sol`** (DROP and TIN, both ERC-3643)
Compliance-first token. **Pattern from Ondo**: every `transfer()` calls:
1. `allowlist.isAllowed(from, to)` — both parties must be KYC'd
2. `blocklist.isBlocked(from, to)` — neither party on blocklist
3. `sanctionsOracle.isSanctioned(from, to)` — Chainalysis oracle check
4. `compliance.canTransfer(from, to, amount)` — ERC-3643 pluggable modules
All four checks on every transfer. No bypass path exists.

Non-rebasing: yield accrues via price appreciation (pool NAV increases), not token rebasing. Simpler tax accounting (Ondo pattern).

Upgradeable proxy (EIP-1967) — allows post-audit improvements without disrupting balances.

**`Compliance.sol`** — pluggable modules per pool:
- `AccreditedInvestorModule` — real estate fund, commercial, business pools
- `MaxBalanceModule` — cap individual % of pool (regulatory diversification)
- `TransferPauseModule` — platform pause (regulatory freeze capability)
- `CountryRestrictionModule` — jurisdiction exclusions per asset
- `SanctionsModule` — wraps Chainalysis oracle (OFAC enforcement at contract level)

**`ProofOfReserve.sol`** (Chainlink PoR integration)
Each pool has a Chainlink Proof of Reserve feed registered to the underlying asset custodian. Circuit-breaker: if PoR feed reports reserve < pool token supply, new deposits are halted automatically. Gives investors autonomous verification of backing without trusting the platform.

**`RWAMarketplace.sol`**
Secondary market atomic swap. Off-chain order book (PostgreSQL), on-chain settlement only.
`settleOrder(orderId, seller, buyer, tokenAmount, usdcAmount)`:
- Checks seller token approval + buyer USDC approval
- Calls `compliance.canTransfer(seller, buyer, amount)` pre-swap
- Atomically swaps tokens + USDC
- Emits `OrderSettled(orderId, ...)`; replays revert

**`PlatformTreasury.sol`**
Gnosis Safe 2-of-3 multi-sig on Hedera EVM. Holds `AssetNFT` collateral, unsold DROP/TIN inventory, platform fee USDC. No automated process moves treasury funds.

### RWA Asset Classes
| Asset | Pool | Tranches | Compliance | Reg Exemption | Chainlink Feed |
|---|---|---|---|---|---|
| Real estate fund | `POOL-REF-01` | DROP + TIN | Accredited + MaxBalance | Reg D 506(c) | PoR (custodian) |
| Commercial buildings | `POOL-CRE-01` | DROP + TIN | Accredited + Country | Reg D 506(b) | PoR (custodian) |
| Businesses (gyms) | `POOL-BIZ-01` | DROP + TIN | Accredited | Reg D 506(b) | PoR (custodian) |
| Commodities | `POOL-COM-01` | DROP only | Country + MaxBalance | CFTC commodity | Data Feed (spot price) |

### Testnet Strategy
- Dev: Hedera testnet + mock USDC (HTS token)
- Staging: Hedera testnet + Circle testnet USDC
- Production: Hedera mainnet after audit
- Phase 5 (multi-chain): Base Sepolia → Base mainnet via Chainlink CCIP

---

## Data Model (Prisma — `apps/backend/src/prisma/schema.prisma`)

### Core entities (new, extends Python CLI's SQLite schema)

```
User               — id, email, phone, passwordHash, enrollmentStatus, kycTier
PasskeyCredential  — credentialId, publicKey, counter, transports (WebAuthn)
UserWallet         — privyWalletId, walletAddress, circleWalletId, circleAddress, onchainIdentityAddress
VerifiableCredential — credentialType, issuerDid, subjectDid, vcJwt, expiresAt, revokedAt
Asset              — symbol, name, assetType, contractAddress, totalSupply, requiresAccreditation
AssetListing       — primary market: pricePerUnit, availableUnits, startDate, status
MarketplaceListing — secondary market: sellerId, tokenAmount, askPrice, onchainApprovalTxHash
Order              — buyerId, listingId, tokenAmount, totalUsdcAmount, status, settlementTxHash
Trade              — immutable record on settlement: orderId, sellerId, buyerId, amounts, txHash
UsdcTransaction    — txHash, direction, amountUsdc (BigInt, 6 decimals), purpose
AuditEvent         — mirrors Python CLI audit table for web/mobile access
```

**Money rule:** All USDC amounts as `BigInt` (6-decimal micro-units). All fiat amounts as `BigInt` cents. No floats anywhere.

**On-chain vs PostgreSQL:**
- On-chain (authoritative): token ownership, USDC balances, ONCHAINID claims, settled trade hashes
- PostgreSQL (authoritative): PII, KYC docs, VC JWTs, order book, asset metadata
- Redis (derived cache): token balances (30s TTL from Alchemy), session tokens

---

## Auth & Token Design

Extends the existing CLI token architecture to all surfaces:

| Token | TTL | Scope | Storage |
|---|---|---|---|
| Session (access) | 15 min | scoped by KYC tier | Memory / Redis |
| Refresh | 7 days | `token:refresh` | Hashed in DB; raw in `~/.bankai/credentials` (CLI) or httpOnly cookie (web) / `expo-secure-store` (mobile) |
| Transaction | 90 sec | single action, bound to amount + account + idempotency key | Memory only |
| Step-up | 5 min | `stepup:<action>`, single-use | Memory only |
| Enrollment | 30 min | `enrollment:write` | Memory only |

**Step-up triggers** (same as CLI, extended for marketplace):
- Transfer > $500
- Any marketplace order (any amount)
- Marketplace listing creation
- Adding external account
- Email/phone/passkey change
- Exporting VC

---

## Identity & Onboarding Flow

```
1. Email + phone entry
2. SMS OTP verification (Twilio Verify)
3. Auth method setup:
   Web  → WebAuthn passkey registration (@simplewebauthn/server)
   Mobile → Privy biometric binding (expo-local-authentication)
4. IDV path choice:
   Option A (iOS fast path): Apple ID Verifier mDL tap
     → nonce generated → Apple Wallet prompted → Face ID → signed mDL response
     → identity-service verifies Apple signature → extract name/DOB/address
     → AML screening → KYC PASS → VC issued
   Option B (fallback): Persona document scan + selfie
     → Persona SDK → OCR + liveness → webhook → KYC result → VC issued
5. On KYC PASS:
   → Veramo issues W3C VC (KYCCredential, did:ethr:base:<wallet_address>)
   → IdentityRegistry.registerIdentity() called on Base (ONCHAINID on-chain)
   → Privy embedded wallet provisioned
   → Circle Programmable Wallet provisioned
   → Account ACTIVE
```

**VC structure:**
```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "KYCCredential"],
  "issuer": "did:hedera:mainnet:<platform_account_id>",
  "credentialSubject": {
    "id": "did:hedera:mainnet:<user_account_id>",
    "kycStatus": "PASSED",
    "tier": "BASIC|ACCREDITED"
  }
}
```
Signed with platform key in AWS KMS. DID anchored via Hedera Consensus Service (HCS) — immutable timestamp proof. Stored in `verifiable_credentials` table + optionally exported to user's external wallet.

---

## Marketplace Flow

### Buy (Secondary Market)
```
1. Buyer selects listing → POST /marketplace/orders
2. Compliance check: buyer's ONCHAINID has required claims for this asset
3. Circle USDC balance check ≥ order total
4. Order APPROVED → two on-chain signatures from buyer:
   a. USDC approve(MarketplaceContract, total) — Privy wallet, biometric gate
   b. POST /marketplace/orders/{id}/submit
5. Backend wallet calls RWAMarketplace.settleOrder() — atomic swap
6. Alchemy Notify webhook confirms → Trade record created → push notification
```

### Sell (Secondary Market)
```
1. Seller chooses asset + quantity + price → POST /marketplace/listings
2. Verify on-chain RWA balance (Alchemy) ≥ quantity
3. On-chain approval: RWAToken.approve(MarketplaceContract, amount) — Privy, biometric
4. Alchemy confirms approval → MarketplaceListing OPEN
```

### Compliance enforcement (dual layer)
- **Layer 1 (backend):** `compliance-check.service.ts` verifies buyer's VC/ONCHAINID before creating Order
- **Layer 2 (contract):** ERC-3643 `transfer()` re-checks `compliance.canTransfer()` — reverts if bypassed

---

## AI Agent Integration

### Python agent retains all existing tools:
`get_balance`, `initiate_transfer`, `schedule_bill_pay`, `list_transactions`, `update_profile`, `list_payees`, `list_external_accounts`, `request_step_up`, `get_agent_activity`

### New tools added to `apps/agent/bankai/agent/tools.py`:
```python
"get_portfolio_summary"    # calls WalletModule HTTP → owned RWA tokens + USDC balance
"list_marketplace_assets"  # calls MarketplaceModule → active asset listings
"get_asset_detail"         # single asset detail, compliance requirements, price history
"initiate_asset_purchase"  # creates Order via MarketplaceModule; returns for user confirmation
"initiate_asset_listing"   # creates MarketplaceListing; returns for user confirmation
```

### FastAPI wrapper (`apps/agent/api_wrapper.py`):
```
POST /agent/chat         { user_id, message, session_context } → { response, tool_calls }
POST /agent/tool-confirm { user_id, tool_name, confirmed }     → { result }
GET  /agent/health
```
`session_context` injected by NestJS includes: `kycTier`, `wallet_address`, `usdc_balance_cents`, `granted_scopes`. The Python agent uses these for portfolio-aware responses without making additional API calls.

**Agent security invariants (unchanged):**
- Agent never proposes completing a transaction — it creates the backend record, UI presents confirmation + step-up
- Marketplace settlement requires user-side on-chain signature (Privy wallet) — agent cannot bypass this
- All tool calls written to `AuditEvent` table (Python SQLite) + mirrored to PostgreSQL `AuditEvent`

---

## Phased Build Order

### Phase 1 — Monorepo Foundation + Mock Demo (Weeks 1–6)
**Goal:** Deployable skeleton across all surfaces; mock end-to-end demo works.

- Init monorepo: pnpm workspaces, Turborepo, shared-types package
- NestJS backend with all modules stubbed; PostgreSQL + Prisma schema; Redis
- FastAPI wrapper around Python agent (no new tools yet)
- Next.js web: login page, dashboard (mock balances), marketplace listing page, agent chat panel
- React Native Expo: tab navigation, mock login, portfolio + marketplace screens
- Hardhat project: RWAToken + RWAMarketplace deploy to Base Sepolia (mock USDC)
- Docker Compose for local development (PostgreSQL, Redis, Python agent, NestJS)
- **Milestone:** `bankai chat` CLI works, web shows mock portfolio, mobile shows mock assets, contract deploys on Sepolia

### Phase 2 — Real Auth + KYC + Wallets (Weeks 7–12)
**Goal:** Real user onboarding with production-grade auth and Persona KYC.

- WebAuthn passkey (web): `@simplewebauthn/server` registration + authentication
- Mobile biometric: Privy SDK + `expo-local-authentication`
- SMS OTP: Twilio Verify integration
- Persona IDV: document scan + selfie flow, webhook handler, KYC state updates
- Apple mDL: Apple ID Verifier API integration (iOS only)
- Veramo VC issuance on KYC PASS
- ONCHAINID registration on Base Sepolia after KYC PASS
- Privy + Circle wallet provisioning on KYC PASS
- Step-up auth on all surfaces (password re-entry on CLI, biometric re-prompt on mobile, passkey re-challenge on web)
- **Milestone:** Real user completes mDL onboarding on iOS, receives VC, sees wallet address

### Phase 3 — On-Chain Settlement + Marketplace (Weeks 13–18)
**Goal:** Real USDC test transactions, on-chain RWA token buys/sells on Sepolia.

- Circle testnet USDC integration
- ERC-4337 Paymaster on Base Sepolia (gasless for users)
- Alchemy Notify webhooks → Redis Streams → GraphQL subscriptions
- Full marketplace buy/sell flow: USDC approval + atomic swap on Sepolia
- P2P transfer with on-chain compliance check
- Order book (PostgreSQL), settlement (on-chain), trade records
- Agent new tools: `get_portfolio_summary`, `list_marketplace_assets`, `initiate_asset_purchase`
- OFAC screening on wallet addresses (Chainalysis or TRM Labs)
- **Milestone:** End-to-end: buy RWA-REF-01 tokens on Sepolia, USDC settles, agent confirms portfolio

### Phase 4 — All Asset Classes + Full Mobile (Weeks 19–24)
**Goal:** All four RWA asset types live, production-quality mobile app.

- Deploy RWA-REF-01 (real estate fund), RWA-CRE-01 (commercial), RWA-BIZ-01 (business), RWA-COM-01 (commodity) to Sepolia
- Per-asset compliance modules with correct regulatory mode
- Accreditation verification flow (accredited investor questionnaire + self-certification)
- Expo push notifications for order fills and blockchain confirmations
- Real-time portfolio updates (GraphQL subscriptions)
- Android biometric hardening
- Web marketplace: full listing browse, buy, sell, transaction history, agent panel
- **Milestone:** All four asset types tradeable on Sepolia; mobile TestFlight submitted

### Phase 5 — Regulatory + Security Hardening (Weeks 25–32)
**Goal:** Production-readiness for real money.

- Smart contract audit (Trail of Bits or OpenZeppelin — scope: Compliance modules + RWAMarketplace)
- Penetration test: auth stack, API, mobile app
- HSM/KMS for VC issuer key and backend signer key (AWS KMS + CloudHSM)
- Gnosis Safe for PlatformTreasury
- Rate limiting hardening, fraud detection hooks
- AML program: suspicious activity report (SAR) filing pipeline
- Legal: securities law opinion letters per asset class; Reg D 506(b)/506(c) filings for real estate/commercial/business assets; CFTC commodity counsel for RWA-COM-01
- Money transmitter: legal analysis of Circle Programmable Wallet structure; MTL assessment
- **Milestone:** Audit report delivered; legal opinions obtained; security pentest remediated

### Phase 6 — Mainnet Launch (Weeks 33–40)
**Goal:** Production launch on Base mainnet with first real asset offering.

- Base mainnet deployment (all contracts)
- Circle mainnet USDC
- Production infrastructure: RDS PostgreSQL, ElastiCache Redis, CloudFront, App Store + Play Store submission
- First asset offering (real estate fund) — accredited investors only (Reg D 506(c))
- Monitoring: Datadog APM, on-chain event alerts, Alchemy Notify → PagerDuty
- Incident response runbook
- **Milestone:** First tokenized asset sold to real accredited investors on Base mainnet

---

## Security Architecture

### Key Management
- **User keys (Privy MPC):** 3-of-3 sharding — Privy HSM (1 share) + device Secure Enclave (1 share) + encrypted recovery share. No single party reconstructs the key alone. Device share only accessible after biometric auth.
- **USDC (Circle):** Circle MPC infrastructure; acknowledged custodial risk; SOC 2 Type II.
- **Platform backend wallet:** AWS KMS with CloudHSM. Holds only `TOKEN_AGENT` + `IDENTITY_REGISTRAR` roles — cannot drain user funds.
- **Treasury:** Gnosis Safe 2-of-3 (CEO, CTO, legal counsel). No automated process can move treasury funds.

### Append-Only Audit Log (unchanged from CLI plan)
- Python SQLite `AuditEvent`: SQLite triggers block UPDATE/DELETE
- PostgreSQL `AuditEvent` (new): PostgreSQL trigger enforces same append-only constraint
- Every agent tool call, every on-chain settlement, every auth event written to both

### Regulatory Landmines
1. **Securities law:** Real estate fund / commercial / business tokens are likely securities (Howey Test). Require Reg D exemption + accredited-investor-only restrictions enforced on-chain. Need registered broker-dealer partnership or ATS registration for secondary market.
2. **Money transmission:** Platform handling USDC flows may be a money transmitter. Circle Programmable Wallet structure may provide a legal path where Circle bears MTL liability — requires legal opinion.
3. **CFTC (commodities):** Tokenized commodity products may be regulated by CFTC, not SEC. Separate counsel required.
4. **AML/BSA:** If classified as MSB or broker-dealer, FINCEN registration and BSA-compliant AML program are mandatory. Persona AML layer + Chainalysis/TRM Labs for on-chain screening.
5. **Data privacy:** Government ID images never stored by platform — Persona SDK sends directly to Persona servers. Platform stores only result + masked attributes (last4, DOB range, name).

---

## Critical Files to Create

### Phase 1 (start here)
- `apps/backend/src/prisma/schema.prisma` — all PostgreSQL entities
- `apps/backend/src/app.module.ts` — NestJS root module
- `apps/agent/api_wrapper.py` — FastAPI HTTP wrapper for Python CLI
- `packages/contracts/contracts/AssetNFT.sol` — ERC-721 real-world asset representation
- `packages/contracts/contracts/RWAPool.sol` — ERC-7540 async vault (Centrifuge pattern)
- `packages/contracts/contracts/RWAToken.sol` — ERC-3643 DROP/TIN tokens with Ondo-style transfer checks
- `packages/contracts/contracts/ProofOfReserve.sol` — Chainlink PoR integration
- `packages/contracts/contracts/RWAMarketplace.sol` — atomic secondary market settlement
- `packages/contracts/hardhat.config.ts` — Hedera testnet + mainnet config (JSON-RPC relay)
- `apps/web/app/(auth)/login/page.tsx` — passkey login UI
- `apps/mobile/app/(auth)/login.tsx` — biometric login UI
- `pnpm-workspace.yaml` + `turbo.json` — monorepo setup
- `docker-compose.yml` — local dev (PostgreSQL, Redis, NestJS, Python agent)

### Security-critical files (must be reviewed carefully)
- `apps/backend/src/auth/jwt/jwt-step-up.guard.ts` — enforces step-up token before mutating ops
- `apps/backend/src/marketplace/settlement.service.ts` — calls `RWAMarketplace.settleOrder`, must validate transaction token before submitting
- `apps/agent/bankai/agent/executor.py` — existing; add new marketplace tool pre-condition checks
- `packages/contracts/contracts/Compliance.sol` — transfer restriction enforcement

---

## Verification

### Phase 1 smoke test
```bash
# Start local stack
docker-compose up -d
npx prisma migrate dev

# CLI agent still works
cd apps/agent && python -m bankai enroll && python -m bankai chat

# FastAPI wrapper
curl http://localhost:8001/agent/health

# Web dev server
cd apps/web && npm run dev  # → http://localhost:3000

# Mobile
cd apps/mobile && npx expo start

# Contract deployment to Hedera testnet (JSON-RPC relay)
cd packages/contracts && npx hardhat ignition deploy --network hedera-testnet
```

### Phase 3 end-to-end test
1. Enroll new user → complete Persona IDV (test mode) → receive VC (did:hedera anchored via HCS)
2. Deposit test USDC (Hedera testnet Circle USDC)
3. Browse marketplace → request deposit into `POOL-REF-01` (ERC-7540 async)
4. After settlement window → claim DROP tokens
5. Verify on HashScan (hashscan.io): USDC deducted, DROP tokens in Privy wallet, PoR feed updated
6. Open agent chat → "what do I own?" → agent returns portfolio with DROP/TIN holdings
7. Check audit log: `agent.tool.call`, `pool.deposit.requested`, `pool.deposit.claimed` all present

### Phase 5 multi-chain test (Chainlink CCIP)
1. Initiate cross-chain transfer of RWA tokens: Hedera testnet → Base Sepolia via CCIP
2. Verify tokens arrive on Base Sepolia with compliance claims intact
3. Execute secondary market trade on Base Sepolia settlement contract

### Continuous
- `npx hardhat test --network hedera-testnet` — all contract unit tests pass including compliance revert cases, PoR circuit-breaker, ERC-7540 async flow
- `pytest apps/agent/tests/` — Python agent unit + integration tests
- `npx jest` — NestJS service unit tests
- HashScan confirms settlement tx, ONCHAINID registration, DROP/TIN token balances
- Chainlink PoR dashboard confirms reserve feeds are active per pool
