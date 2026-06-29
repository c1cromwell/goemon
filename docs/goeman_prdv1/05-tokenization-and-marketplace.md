# 05 — Tokenization & Marketplace

## Marketplace concept

The marketplace is the wedge product. It's structured as **two surfaces under one tab**:

- **Invest** — securities-style RWAs (tokenized treasuries, real estate fractions, private credit)
- **Collect** — physical collectibles (graded TCG, sports memorabilia, watches, sneakers) and Web3-native gaming items

Both surfaces share the same listing infrastructure, search/filter, transaction flow, and wallet integration. They differ in compliance posture (Invest requires Tier 2+ for purchase; Collect is mostly Tier 0/1 accessible) and in UX emphasis (Invest leads with yield and fundamentals; Collect leads with imagery and provenance).

## v1 listings — Invest surface

Goeman Global Finance does not issue tokens in v1. We list third-party tokenized assets through partnerships. Target ~10 assets across three categories at launch:

### Tokenized US Treasuries (target: 3 listings)

| Asset | Issuer | Chain bridge required | Min purchase |
|---|---|---|---|
| BUIDL (BlackRock USD Institutional Digital Liquidity Fund) | BlackRock via Securitize | Ethereum → Hedera via CCTP-equivalent for asset | TBD by issuer |
| BENJI (Franklin OnChain US Government Money Fund) | Franklin Templeton | Stellar → Hedera | $20 |
| OUSG (Ondo Short-Term US Government Treasuries) | Ondo Finance | Ethereum → Hedera | $100 |

For v1, the listings are *displayed and orderable* through Goeman Global Finance but settlement may happen on the issuer's native chain with Goeman Global Finance acting as an order router. Where the asset is available natively on Hedera (BENJI is targeting this; BUIDL is exploring), settlement is local.

### Tokenized real estate and private credit (target: 4 listings)

| Asset type | Partner | Structure |
|---|---|---|
| Single-property residential fractions | RealT (or similar) | ERC-3643 tokens representing equity in single-property LLCs |
| Multi-property residential portfolio | Lofty, Arrived | Token represents share in a fund |
| Private credit pool | Centrifuge | Senior/junior tranche tokens |
| Trade finance receivables | Centrifuge or Maple | Yield-bearing tranches |

These typically require Tier 2 (US accredited or international qualified investor for some) and have varying lock-up periods.

### Other RWAs (target: 3 listings)

| Asset type | Partner | Notes |
|---|---|---|
| Tokenized gold | Paxos PAXG | Backed 1:1 by physical gold in London Bullion Market vaults |
| Music royalties | Royal, ANote Music | Fractional ownership of song royalty streams |
| Carbon credits | Toucan, KlimaDAO | Tokenized voluntary carbon offsets |

## v1 listings — Collect surface

### Graded trading cards and collectibles (target: 200+ unique items)

Partnership with **Courtyard** (insured Delaware vault, PSA grading, NFT-on-Polygon → we'd bridge to Hedera) and/or **Collector Crypt** (Solana-native, broader categories — we'd display via CCTP bridging).

Categories included:
- Pokémon TCG (PSA 8+ for most listings)
- Magic: The Gathering
- Sports cards (PSA-graded baseball, basketball, football)
- Comic books (CGC-graded)
- Watches (specific high-value pieces, custodied by partner)
- Sneakers (selective, custodied by StockX-style partner)

Each listing shows: asset image (multiple angles), grading certificate, physical custody location, ask price in USDC, recent comparable sales, and redemption process for physical possession.

### Web3-native gaming (target: 4-6 game integrations)

| Game | Developer | Asset types |
|---|---|---|
| Off The Grid | Gunzilla Games | Weapon skins, character cosmetics |
| Shrapnel | Neon Machine | Tactical equipment, character mods |
| Parallel | Echelon Prime | Trading cards (TCG) |
| Star Atlas | ATMTA | Ships, equipment |
| Illuvium | Illuvium Labs | Creatures, equipment |
| Sorare | Sorare | Football/sports NFT cards |

**Explicitly excluded from v1:** Call of Duty items, FIFA/EA Sports items, Fortnite items, any Roblox UGC, or any other asset where the publisher has not officially sanctioned third-party tokenization. We don't list assets we can't legally guarantee transfer of.

## Token standards

### ERC-3643 (T-REX) on HSCS — for securities

Goeman Global Finance uses ERC-3643 for any tokenized asset that is or could be a security. The standard enforces transfer restrictions on-chain via:

- **Identity Registry** — every holder is mapped to an on-chain identity object containing their verified claims (KYC tier, jurisdiction, accreditation status)
- **Compliance Module** — pluggable rules engine that gates transfers based on identity claims (e.g., "no transfers to jurisdiction X," "no transfers under $1K," "no transfers if it would push holder count over 99 for Reg D")

We operate the Identity Registry for assets we list; for assets where the issuer operates their own registry (BUIDL, BENJI), we connect to theirs.

**Requirements:**
- `[REQ-MK-TOK-001]` ERC-3643 contracts deployed on HSCS must pass Tokeny's compliance audit before going live
- `[REQ-MK-TOK-002]` Identity Registry updates (a user upgrading KYC tier) propagate to on-chain claims within 15 minutes
- `[REQ-MK-TOK-003]` Failed transfers due to compliance rules surface a clear error to the user explaining why (e.g., "This asset requires accredited investor status")
- `[REQ-MK-TOK-004]` ERC-3643 contracts are upgradeable via timelock + multi-sig; emergency pause functionality requires 2-of-3 multi-sig signatures

### HTS native — for collectibles, gaming, and stablecoin operations

For non-securities (collectibles, game assets, USDC operations), we use Hedera Token Service native tokens. Cheaper, faster, simpler.

HTS tokens can carry compliance metadata via:
- **KYC key** — Goeman Global Finance-controlled key that can grant/revoke KYC status per holder
- **Freeze key** — Goeman Global Finance-controlled key that can freeze individual holders (for fraud, sanctions, etc.)
- **Wipe key** — used rarely, for fraud or court-ordered remediation
- **Custom fees** — optional royalty to issuer/Goeman Global Finance on transfer

**Requirements:**
- `[REQ-MK-TOK-005]` HTS tokens for collectibles include a Freeze key controlled by Goeman Global Finance's compliance multisig
- `[REQ-MK-TOK-006]` Royalty fees, where applied, are disclosed in the listing detail before purchase
- `[REQ-MK-TOK-007]` Tokens representing physical-backed assets include metadata pointing to the custody attestation (auditable proof-of-reserve)

## Listing lifecycle

How an asset gets onto the marketplace:

1. **Partnership signed** with issuer/custody partner — commercial terms, technical integration scope
2. **Asset due diligence** — agent-assisted research pass (Module 08) + human compliance review verifies issuer legitimacy, regulatory status, custody attestation, contract audit reports
3. **Technical integration** — bridging setup (if needed), Identity Registry connection (for ERC-3643), metadata pipeline (images, descriptions, real-time pricing)
4. **Internal staging** — listing appears in admin console for QA; test users buy/sell internally
5. **Soft launch** — listing visible to ≤1% of users, monitored for issues
6. **Public launch** — listing visible to all eligible users (subject to KYC/jurisdiction filters)
7. **Ongoing monitoring** — Chainlink proof-of-reserve feeds (where applicable), compliance rescreen, partner SLA monitoring

**Requirements:**
- `[REQ-MK-LIFE-001]` Each listing has a versioned "listing record" that captures issuer info, contract address, due diligence outcome, and reviewer signatures
- `[REQ-MK-LIFE-002]` Listings can be paused or delisted by Goeman Global Finance at any time; user holdings are preserved but new orders are blocked
- `[REQ-MK-LIFE-003]` Delisted assets continue to display in user portfolios with a "no longer listed" marker; users can still transfer or redeem if those mechanisms are partner-supported

## Trade execution

### Primary issuance (subscribe to a new offering)

For assets that have a subscription period rather than continuous trading (real estate fractions, private credit tranches):
- User selects amount/units, confirms
- USDC moves to an escrow contract until subscription period closes
- At close, tokens distribute to subscribers, surplus USDC returns
- If undersubscribed and the deal cancels, all USDC returns

### Secondary trading (continuous market)

For assets with ongoing liquidity (treasuries, gold, gaming items, collectibles):
- Order book or AMM, depending on asset characteristics
- Treasuries and gold: NAV-driven pricing with issuer redemption mechanism; user gets a fair price guaranteed by issuer
- Collectibles and gaming: marketplace listing (seller sets ask, buyer takes or makes offer) — model proven by OpenSea, Magic Eden, Courtyard
- Real estate fractions: order book matching internal buy/sell intent across Goeman Global Finance users where the asset's transfer rules permit

### Direct transfer (user-to-user)

For non-securities assets, direct transfer between Goeman Global Finance users is supported. ERC-3643 securities require recipient to be on the Identity Registry; same-user transfer to an external wallet is possible if the destination address is registered.

**Requirements:**
- `[REQ-MK-EXEC-001]` Order entry shows total cost (asset price + any platform/issuer fees + estimated gas, though gas is sponsored) before confirmation
- `[REQ-MK-EXEC-002]` Partial fills are supported for order book trades
- `[REQ-MK-EXEC-003]` Settlement is atomic (USDC and asset transfer in single transaction or both revert); for cross-chain settlement, escrow + reconciliation pattern
- `[REQ-MK-EXEC-004]` Failed trades return USDC within 5 minutes (same-chain) or 1 hour (cross-chain)

## Pricing and discovery

Where prices come from:

- **NAV-driven assets (funds, treasuries):** issuer-published NAV updated daily or per issuer cadence, exposed via Chainlink price feed where available
- **Spot-priced assets (gold, FX):** Chainlink price feeds
- **Market-priced assets (collectibles, gaming):** internal order book; floor price = lowest current ask
- **Comparables for collectibles:** integration with Courtyard's historical sales data, eBay sold listings (for cards specifically), PSA Auction Prices Realized

**Requirements:**
- `[REQ-MK-PRICE-001]` Every listing's displayed price has a clearly-labeled source and "as of" timestamp
- `[REQ-MK-PRICE-002]` Stale prices (>24 hours for daily-updating assets, >1 hour for spot, >7 days for market-priced) display a warning
- `[REQ-MK-PRICE-003]` Pricing manipulation detection runs on all market-priced listings (wash trade detection, suspicious volume spikes)

## Fees

Goeman Global Finance's revenue model on the marketplace is a combination of:

- **Spread/markup** on primary issuance (typically 0.25-1.0% depending on partner agreement)
- **Trading fee** on secondary trades (0.5-1.5% depending on asset class; collectibles higher than treasuries)
- **Custody fee pass-through** where applicable (physical-backed assets carry a small custody fee, typically <0.5%/yr, embedded in the asset's NAV not separately charged)

**Requirements:**
- `[REQ-MK-FEE-001]` All fees are fully disclosed in the order confirmation screen before user confirms
- `[REQ-MK-FEE-002]` No hidden fees or post-trade adjustments
- `[REQ-MK-FEE-003]` Fee structure is uniform per asset class; no tier-based fee discounts in v1 (added in v2 with Goeman Global Finance Plus)

## Out of scope for v1

- First-party tokenization (Goeman Global Finance issuing its own RWA tokens) — v2
- Derivatives, leverage, margin trading
- Tokenized equities (legally complex in US; international only in v2)
- Tokenized debt obligations of Goeman Global Finance users (peer lending)
- Yield farming, staking, liquidity providing
- Auctions (English, Dutch, sealed-bid) — v2 for collectibles
- Curated drops or limited-edition releases — v2

## Cross-references

- For how identity tiers gate marketplace access, see [03 — Identity & Onboarding](./03-identity-and-onboarding.md)
- For wallet handling of purchased assets, see [04 — Wallet & Custody](./04-wallet-and-custody.md)
- For compliance review of new listings, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
- For the agent skill that runs DD on potential listings, see [08 — Agent Operations](./08-agent-operations.md)
